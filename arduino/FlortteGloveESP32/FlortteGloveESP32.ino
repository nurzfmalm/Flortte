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
const int MIN_CALIBRATION_RANGE = 120;
const unsigned long BLE_PUBLISH_INTERVAL_MS = 100;
const unsigned long SERIAL_PRINT_INTERVAL_MS = 250;

BLECharacteristic* txCharacteristic = nullptr;
Preferences preferences;
bool deviceConnected = false;
bool wasConnected = false;
bool isCalibrating = false;
bool hasCalibration = false;
bool hasPendingBentPose = false;
unsigned long calibratedAt = 0;
unsigned long lastBlePublish = 0;
unsigned long lastSerialPrint = 0;

int bentValues[FINGER_COUNT] = {};
int straightValues[FINGER_COUNT] = {};
int pendingBentValues[FINGER_COUNT] = {};
int rawValues[FINGER_COUNT] = {};
int calibratedValues[FINGER_COUNT] = {};
int bendPercents[FINGER_COUNT] = {};
float filteredValues[FINGER_COUNT] = {};
bool fingerEnabled[FINGER_COUNT] = {};
const char* calibrationStage = "idle";

enum CalibrationCommand : uint8_t {
  CALIBRATION_NONE,
  CALIBRATION_START,
  CALIBRATION_BENT,
  CALIBRATION_OPEN,
  CALIBRATION_CANCEL,
};
volatile CalibrationCommand pendingCalibrationCommand = CALIBRATION_NONE;

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
  hasPendingBentPose = false;
  calibrationStage = "bent";
  Serial.println("BLE CALIBRATION START");
}

void captureBentPose() {
  if (!isCalibrating) beginCalibration();
  for (int i = 0; i < FINGER_COUNT; i++) pendingBentValues[i] = readAverage(FLEX_PINS[i]);
  hasPendingBentPose = true;
  calibrationStage = "open";
  Serial.println("Bent pose saved.");
}

void saveCalibration() {
  for (int i = 0; i < FINGER_COUNT; i++) {
    char bentKey[4];
    char straightKey[4];
    snprintf(bentKey, sizeof(bentKey), "b%d", i);
    snprintf(straightKey, sizeof(straightKey), "s%d", i);
    preferences.putInt(bentKey, bentValues[i]);
    preferences.putInt(straightKey, straightValues[i]);
  }
  preferences.putBool("valid", hasCalibration);
}

void captureStraightPose() {
  if (!isCalibrating || !hasPendingBentPose) {
    Serial.println("Straight pose ignored: capture the bent pose first.");
    return;
  }
  bool anyEnabled = false;
  for (int i = 0; i < FINGER_COUNT; i++) {
    straightValues[i] = readAverage(FLEX_PINS[i]);
    bentValues[i] = pendingBentValues[i];
    fingerEnabled[i] = abs(straightValues[i] - bentValues[i]) >= MIN_CALIBRATION_RANGE;
    anyEnabled = anyEnabled || fingerEnabled[i];
    filteredValues[i] = straightValues[i];
  }
  hasCalibration = anyEnabled;
  hasPendingBentPose = false;
  calibratedAt = millis();
  isCalibrating = false;
  calibrationStage = "idle";
  saveCalibration();
  Serial.println("Straight pose saved. Calibration complete.");
}

void cancelCalibration() {
  isCalibrating = false;
  hasPendingBentPose = false;
  calibrationStage = "idle";
  Serial.println("Calibration cancelled. Previous values preserved.");
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
}

void loadCalibration() {
  if (!preferences.getBool("valid", false)) return;

  bool anyEnabled = false;
  for (int i = 0; i < FINGER_COUNT; i++) {
    char bentKey[4];
    char straightKey[4];
    snprintf(bentKey, sizeof(bentKey), "b%d", i);
    snprintf(straightKey, sizeof(straightKey), "s%d", i);
    bentValues[i] = preferences.getInt(bentKey, -1);
    straightValues[i] = preferences.getInt(straightKey, -1);
    const bool valuesValid = bentValues[i] >= 0 && bentValues[i] <= 4095
      && straightValues[i] >= 0 && straightValues[i] <= 4095;
    fingerEnabled[i] = valuesValid
      && abs(straightValues[i] - bentValues[i]) >= MIN_CALIBRATION_RANGE;
    anyEnabled = anyEnabled || fingerEnabled[i];
  }

  hasCalibration = anyEnabled;
  if (!hasCalibration) preferences.putBool("valid", false);
  Serial.println(hasCalibration ? "Saved calibration loaded." : "Saved calibration is invalid.");
}

String buildSensorJson() {
  String json = "{\"sensors\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i) json += ',';
    json += '\"'; json += FINGER_KEYS[i]; json += "\":"; json += calibratedValues[i];
  }
  json += "},\"enabled\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i) json += ',';
    json += '\"'; json += FINGER_KEYS[i]; json += "\":";
    json += fingerEnabled[i] ? "true" : "false";
  }
  json += "},\"calibrating\":";
  json += isCalibrating ? "true" : "false";
  json += ",\"calibrated\":";
  json += hasCalibration ? "true" : "false";
  json += ",\"calibrationStage\":\"";
  json += calibrationStage;
  json += '\"';
  json += '}';
  return json;
}

void publishState() {
  String json = buildSensorJson();
  txCharacteristic->setValue(json.c_str());
  if (deviceConnected) txCharacteristic->notify();
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
    Serial.println("Bluetooth client disconnected.");
  }
};

class CommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    String command = characteristic->getValue().c_str();
    command.trim();
    command.toLowerCase();

    // Calibration work is deliberately performed in loop(), not inside the BLE callback.
    if (command == "calibrate:start") pendingCalibrationCommand = CALIBRATION_START;
    else if (command == "calibrate:bent") pendingCalibrationCommand = CALIBRATION_BENT;
    else if (command == "calibrate:open") pendingCalibrationCommand = CALIBRATION_OPEN;
    else if (command == "calibrate:cancel") pendingCalibrationCommand = CALIBRATION_CANCEL;
    else Serial.println("Unknown BLE command: " + command);
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
  preferences.begin("flortte", false);
  loadCalibration();
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
  const CalibrationCommand command = pendingCalibrationCommand;
  if (command != CALIBRATION_NONE) {
    pendingCalibrationCommand = CALIBRATION_NONE;
    if (command == CALIBRATION_START) beginCalibration();
    else if (command == CALIBRATION_BENT) captureBentPose();
    else if (command == CALIBRATION_OPEN) captureStraightPose();
    else if (command == CALIBRATION_CANCEL) cancelCalibration();
  }

  if (!isCalibrating) updateSensors();

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
