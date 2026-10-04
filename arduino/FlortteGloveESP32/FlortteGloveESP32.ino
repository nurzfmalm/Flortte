#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Preferences.h>

// BLE UART-compatible service. Read/subscribe to TX for sensor data and write
// commands to RX. Commands: calibrate:start, calibrate:bent,
// calibrate:open and calibrate:cancel.
const char* BLE_DEVICE_NAME = "FlortteGlove";
const char* BLE_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const char* BLE_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const char* BLE_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

const int FINGER_COUNT = 5;
const int FLEX_PINS[FINGER_COUNT] = {32, 33, 34, 35, 25};
const char* FINGER_KEYS[FINGER_COUNT] = {"key", "index", "middle", "ring", "little"};
const char* FINGER_NAMES[FINGER_COUNT] = {"KEY", "INDEX", "MIDDLE", "RING", "LITTLE"};

const float ALPHA = 0.12f;
const int SAMPLES = 25;
const int SAMPLE_DELAY_MS = 2;
const int DEAD_ZONE_PERCENT = 3;
const int MIN_CALIBRATION_RANGE = 20;
const unsigned long BLE_PUBLISH_INTERVAL_MS = 100;
const unsigned long SERIAL_PRINT_INTERVAL_MS = 250;

BLECharacteristic* txCharacteristic = nullptr;
volatile bool deviceConnected = false;
bool wasConnected = false;
bool isCalibrating = false;
bool hasBentPose = false;
bool calibrationSaved = false;
enum class CalibrationCommand { NONE, START, BENT, OPEN, CANCEL };
volatile CalibrationCommand pendingCommand = CalibrationCommand::NONE;
portMUX_TYPE commandMux = portMUX_INITIALIZER_UNLOCKED;
const char* calibrationStep = "idle";
unsigned long calibrationSeq = 0;
unsigned long calibratedAt = 0;
unsigned long lastBlePublish = 0;
unsigned long lastSerialPrint = 0;

int bentValues[FINGER_COUNT] = {};
int pendingBentValues[FINGER_COUNT] = {};
int straightValues[FINGER_COUNT] = {};
int rawValues[FINGER_COUNT] = {};
int calibratedValues[FINGER_COUNT] = {};
int bendPercents[FINGER_COUNT] = {};
float filteredValues[FINGER_COUNT] = {};
bool fingerEnabled[FINGER_COUNT] = {};

int readAverage(int pin) {
  long sum = 0;
  for (int i = 0; i < SAMPLES; i++) {
    sum += analogRead(pin);
    delay(SAMPLE_DELAY_MS);
  }
  return sum / SAMPLES;
}

void beginCalibration() {
  isCalibrating = true;
  hasBentPose = false;
  calibrationStep = "prepare";
  Serial.println("BLE CALIBRATION START");
}

void captureBentPose() {
  if (!isCalibrating) { calibrationStep = "error"; return; }
  for (int i = 0; i < FINGER_COUNT; i++) pendingBentValues[i] = readAverage(FLEX_PINS[i]);
  hasBentPose = true;
  calibrationStep = "bent";
  Serial.println("Bent pose saved.");
}

void captureStraightPose() {
  if (!isCalibrating || !hasBentPose) { calibrationStep = "error"; return; }
  int candidateStraight[FINGER_COUNT];
  bool anyEnabled = false;
  for (int i = 0; i < FINGER_COUNT; i++) {
    candidateStraight[i] = readAverage(FLEX_PINS[i]);
    anyEnabled |= abs(candidateStraight[i] - pendingBentValues[i]) >= MIN_CALIBRATION_RANGE;
  }
  // A failed attempt or cancellation must leave the working calibration intact.
  if (!anyEnabled) { calibrationStep = "error"; return; }
  portENTER_CRITICAL(&commandMux);
  if (pendingCommand == CalibrationCommand::CANCEL || !deviceConnected) {
    portEXIT_CRITICAL(&commandMux);
    return;
  }
  for (int i = 0; i < FINGER_COUNT; i++) {
    bentValues[i] = pendingBentValues[i];
    straightValues[i] = candidateStraight[i];
    fingerEnabled[i] = abs(straightValues[i] - bentValues[i]) >= MIN_CALIBRATION_RANGE;
    filteredValues[i] = straightValues[i];
  }
  calibratedAt = millis();
  isCalibrating = false;
  hasBentPose = false;
  calibrationStep = "done";
  portEXIT_CRITICAL(&commandMux);
  Preferences preferences;
  calibrationSaved = false;
  if (preferences.begin("flortte", false)) {
    // Save both poses together so an interrupted write cannot mix two attempts.
    int poses[FINGER_COUNT * 2];
    for (int i = 0; i < FINGER_COUNT; i++) {
      poses[i] = bentValues[i];
      poses[FINGER_COUNT + i] = straightValues[i];
    }
    calibrationSaved = preferences.putBytes("poses", poses, sizeof(poses)) == sizeof(poses);
    preferences.end();
  }
  Serial.println("Straight pose saved. Calibration complete.");
}

int toCalibratedAdc(int index, int value) {
  if (!fingerEnabled[index]) return 4095;
  if (abs(straightValues[index] - bentValues[index]) < MIN_CALIBRATION_RANGE) return 4095;
  return constrain(map(value, straightValues[index], bentValues[index], 4095, 0), 0, 4095);
}

int toBendPercent(int index, int value) {
  if (!fingerEnabled[index]) return 0;
  if (abs(straightValues[index] - bentValues[index]) < MIN_CALIBRATION_RANGE) return 0;
  int percent = constrain(map(value, straightValues[index], bentValues[index], 0, 100), 0, 100);
  return percent < DEAD_ZONE_PERCENT ? 0 : percent;
}

void updateSensors() {
  for (int i = 0; i < FINGER_COUNT; i++) {
    rawValues[i] = readAverage(FLEX_PINS[i]);
    filteredValues[i] += ALPHA * (rawValues[i] - filteredValues[i]);
    calibratedValues[i] = toCalibratedAdc(i, (int)filteredValues[i]);
    bendPercents[i] = toBendPercent(i, (int)filteredValues[i]);
  }
}

void initializeSensors() {
  for (int i = 0; i < FINGER_COUNT; i++) {
    analogSetPinAttenuation(FLEX_PINS[i], ADC_11db);
    rawValues[i] = readAverage(FLEX_PINS[i]);
    filteredValues[i] = rawValues[i];
    // Until calibration, expose the raw ADC values as before.
    straightValues[i] = 4095;
    bentValues[i] = 0;
    fingerEnabled[i] = true;
    calibratedValues[i] = rawValues[i];
  }
  Preferences preferences;
  if (preferences.begin("flortte", true)) {
    int poses[FINGER_COUNT * 2];
    bool valid = preferences.getBytesLength("poses") == sizeof(poses) &&
      preferences.getBytes("poses", poses, sizeof(poses)) == sizeof(poses);
    bool anyEnabled = false;
    if (valid) {
      for (int i = 0; i < FINGER_COUNT * 2; i++) valid &= poses[i] >= 0 && poses[i] <= 4095;
      for (int i = 0; i < FINGER_COUNT; i++) anyEnabled |= abs(poses[FINGER_COUNT + i] - poses[i]) >= MIN_CALIBRATION_RANGE;
    }
    if (valid && anyEnabled) {
      calibrationSaved = true;
      for (int i = 0; i < FINGER_COUNT; i++) {
        bentValues[i] = poses[i];
        straightValues[i] = poses[FINGER_COUNT + i];
        fingerEnabled[i] = abs(straightValues[i] - bentValues[i]) >= MIN_CALIBRATION_RANGE;
        calibratedValues[i] = toCalibratedAdc(i, rawValues[i]);
        bendPercents[i] = toBendPercent(i, rawValues[i]);
      }
    }
    preferences.end();
  }
}

String buildSensorJson() {
  String json = "{\"sensors\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i) json += ',';
    json += '\"'; json += FINGER_KEYS[i]; json += "\":"; json += calibratedValues[i];
  }
  json += "},\"bendPercent\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i) json += ',';
    json += '\"'; json += FINGER_KEYS[i]; json += "\":"; json += bendPercents[i];
  }
  json += "},\"calibrating\":";
  json += isCalibrating ? "true" : "false";
  json += ",\"calibrationSeq\":"; json += calibrationSeq;
  json += ",\"calibrationStep\":\""; json += calibrationStep; json += '\"';
  json += ",\"calibratedAt\":"; json += calibratedAt;
  json += ",\"calibrationSaved\":"; json += calibrationSaved ? "true" : "false";
  json += ",\"enabled\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i) json += ',';
    json += '\"'; json += FINGER_KEYS[i]; json += "\":";
    json += fingerEnabled[i] ? "true" : "false";
  }
  json += '}';
  json += '}';
  return json;
}

void publishState() {
  String json = buildSensorJson();
  if (deviceConnected) {
    // 20 bytes work even with the minimum BLE MTU (23), including Windows.
    String frame = "~" + json + "\n";
    for (unsigned int offset = 0; offset < frame.length() && deviceConnected; offset += 20) {
      String chunk = frame.substring(offset, offset + 20);
      txCharacteristic->setValue(chunk.c_str());
      txCharacteristic->notify();
      delay(5);
    }
  }
  // A GATT read returns the complete, unframed state.
  txCharacteristic->setValue(json.c_str());
}

void printSensorLine() {
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i) Serial.print(" | ");
    Serial.print(FINGER_NAMES[i]); Serial.print(' ');
    Serial.print(rawValues[i]); Serial.print('/');
    Serial.print(calibratedValues[i]); Serial.print('/');
    Serial.print(bendPercents[i]); Serial.print('%');
  }
  Serial.println();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    deviceConnected = true;
    Serial.println("Bluetooth client connected.");
  }

  void onDisconnect(BLEServer*) override {
    deviceConnected = false;
    portENTER_CRITICAL(&commandMux);
    pendingCommand = CalibrationCommand::CANCEL;
    portEXIT_CRITICAL(&commandMux);
    Serial.println("Bluetooth client disconnected.");
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    String command = characteristic->getValue().c_str();
    command.trim();
    command.toLowerCase();

    CalibrationCommand requested = CalibrationCommand::NONE;
    if (command == "calibrate:start") requested = CalibrationCommand::START;
    else if (command == "calibrate:bent") requested = CalibrationCommand::BENT;
    else if (command == "calibrate:open") requested = CalibrationCommand::OPEN;
    else if (command == "calibrate:cancel") requested = CalibrationCommand::CANCEL;
    else { Serial.println("Unknown BLE command: " + command); return; }
    // All state changes and sensor reads happen in loop(), after the BLE write.
    portENTER_CRITICAL(&commandMux);
    if (pendingCommand == CalibrationCommand::NONE || requested == CalibrationCommand::CANCEL) pendingCommand = requested;
    portEXIT_CRITICAL(&commandMux);
  }
};

void setupBluetooth() {
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEDevice::setMTU(247);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(BLE_SERVICE_UUID);

  txCharacteristic = service->createCharacteristic(
    BLE_TX_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  txCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic* rxCharacteristic = service->createCharacteristic(
    BLE_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rxCharacteristic->setCallbacks(new CommandCallbacks());

  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  analogReadResolution(12);
  initializeSensors();
  setupBluetooth();

  Serial.println("FLORTTE GLOVE BLE START");
  Serial.print("Flex pins: ");
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i) Serial.print(", ");
    Serial.print(FINGER_NAMES[i]); Serial.print('='); Serial.print(FLEX_PINS[i]);
  }
  Serial.println();
  Serial.println("Bluetooth device: FlortteGlove");
}

void loop() {
  portENTER_CRITICAL(&commandMux);
  CalibrationCommand command = pendingCommand;
  pendingCommand = CalibrationCommand::NONE;
  portEXIT_CRITICAL(&commandMux);
  if (command != CalibrationCommand::NONE) {
    if (command == CalibrationCommand::START) beginCalibration();
    else if (command == CalibrationCommand::BENT) captureBentPose();
    else if (command == CalibrationCommand::OPEN) captureStraightPose();
    else if (command == CalibrationCommand::CANCEL) {
      isCalibrating = false;
      hasBentPose = false;
      calibrationStep = "idle";
    }
    calibrationSeq++;
  }

  // Keep telemetry live while holding the previous calibration until commit.
  updateSensors();

  if (millis() - lastBlePublish >= BLE_PUBLISH_INTERVAL_MS) {
    lastBlePublish = millis();
    publishState();
  }
  if (millis() - lastSerialPrint >= SERIAL_PRINT_INTERVAL_MS) {
    lastSerialPrint = millis();
    printSensorLine();
  }

  if (!deviceConnected && wasConnected) {
    delay(200);
    BLEDevice::startAdvertising();
    wasConnected = false;
  }
  if (deviceConnected && !wasConnected) wasConnected = true;
  delay(10);
}
