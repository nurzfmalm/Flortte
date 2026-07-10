#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

const char* WIFI_SSID = "";
const char* WIFI_PASSWORD = "";
const char* WIFI_HOSTNAME = "flortte-glove";
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 15000;

const char* AP_SSID = "FlortteGlove";
const char* AP_PASSWORD = "flortte123";

const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

const int BUTTON_PIN = 0; // IO0 / BOOT
const int SERVER_PORT = 8080;

const int FINGER_COUNT = 3;
const int FLEX_PINS[FINGER_COUNT] = {32, 33, 34};
const bool FINGER_PRESENT[FINGER_COUNT] = {true, true, true};
const char* FINGER_KEYS[FINGER_COUNT] = {"keyPinch", "indexThumb", "middleThumb"};
const char* FINGER_NAMES[FINGER_COUNT] = {"THUMB", "INDEX", "MIDDLE"};

const float ALPHA = 0.12f;
const int SAMPLES = 25;
const int SAMPLE_DELAY_MS = 2;
const int DEAD_ZONE_PERCENT = 3;
const int MIN_CALIBRATION_RANGE = 20;

WebServer server(SERVER_PORT);

int bentValues[FINGER_COUNT] = {0, 0, 0};
int straightValues[FINGER_COUNT] = {4095, 4095, 4095};
int rawValues[FINGER_COUNT] = {4095, 4095, 4095};
int calibratedValues[FINGER_COUNT] = {4095, 4095, 4095};
int bendPercents[FINGER_COUNT] = {0, 0, 0};
float filteredValues[FINGER_COUNT] = {4095, 4095, 4095};
bool fingerEnabled[FINGER_COUNT] = {true, true, true};

bool isCalibrating = false;
bool apFallbackActive = false;
unsigned long calibratedAt = 0;
unsigned long lastSerialPrint = 0;
unsigned long lastWiFiCheck = 0;

int readAverage(int pin) {
  long sum = 0;

  for (int i = 0; i < SAMPLES; i++) {
    sum += analogRead(pin);
    delay(SAMPLE_DELAY_MS);
  }

  return sum / SAMPLES;
}

void waitForButtonPress() {
  while (digitalRead(BUTTON_PIN) == HIGH) {
    delay(10);
  }

  delay(50);

  while (digitalRead(BUTTON_PIN) == LOW) {
    delay(10);
  }

  delay(200);
}

void printFingerPrompt(int index, const char* pose) {
  Serial.println();
  Serial.print(FINGER_NAMES[index]);
  Serial.print(": ");
  Serial.println(pose);
  Serial.println("Press IO0 / BOOT to save.");
}

void disableFinger(int index) {
  fingerEnabled[index] = false;
  straightValues[index] = 4095;
  bentValues[index] = 4095;
  filteredValues[index] = 4095;
  calibratedValues[index] = 4095;
  bendPercents[index] = 0;

  Serial.print(FINGER_NAMES[index]);
  Serial.println(" disabled: range is too small, sensor/finger is optional.");
}

void calibrateFinger(int index) {
  if (!FINGER_PRESENT[index]) {
    Serial.println();
    Serial.print("SKIPPING ");
    Serial.print(FINGER_NAMES[index]);
    Serial.println(": marked as not installed in FINGER_PRESENT.");
    disableFinger(index);
    return;
  }

  Serial.println();
  Serial.print("CALIBRATING ");
  Serial.println(FINGER_NAMES[index]);

  printFingerPrompt(index, "bend this finger to MAXIMUM");
  waitForButtonPress();
  bentValues[index] = readAverage(FLEX_PINS[index]);
  Serial.print("Bent value saved: ");
  Serial.println(bentValues[index]);

  printFingerPrompt(index, "straighten this finger");
  waitForButtonPress();
  straightValues[index] = readAverage(FLEX_PINS[index]);
  Serial.print("Straight value saved: ");
  Serial.println(straightValues[index]);

  int range = abs(straightValues[index] - bentValues[index]);
  Serial.print("Range: ");
  Serial.println(range);

  if (range >= MIN_CALIBRATION_RANGE) {
    fingerEnabled[index] = true;
    filteredValues[index] = readAverage(FLEX_PINS[index]);
    Serial.print(FINGER_NAMES[index]);
    Serial.println(" calibration done.");
    return;
  }

  disableFinger(index);
  delay(1000);
}

void calibrateAllSensors() {
  isCalibrating = true;

  Serial.println();
  Serial.println("CALIBRATION START");
  Serial.println("Calibrate each finger separately.");
  Serial.println("If a finger/sensor is missing, save the same pose twice.");

  for (int i = 0; i < FINGER_COUNT; i++) {
    calibrateFinger(i);
  }

  calibratedAt = millis();
  isCalibrating = false;

  Serial.println();
  Serial.println("CALIBRATION DONE");
  Serial.println("Reading data...");
  Serial.println();
}

int toCalibratedAdc(int index, int cleanValue) {
  if (!fingerEnabled[index]) return 4095;

  int range = abs(straightValues[index] - bentValues[index]);
  if (range < MIN_CALIBRATION_RANGE) return 4095;

  long value = map(cleanValue, straightValues[index], bentValues[index], 4095, 0);
  return constrain(value, 0, 4095);
}

int toBendPercent(int index, int cleanValue) {
  if (!fingerEnabled[index]) return 0;

  int range = abs(straightValues[index] - bentValues[index]);
  if (range < MIN_CALIBRATION_RANGE) return 0;

  long percent = map(cleanValue, straightValues[index], bentValues[index], 0, 100);
  percent = constrain(percent, 0, 100);

  if (percent < DEAD_ZONE_PERCENT) {
    percent = 0;
  }

  return percent;
}

void updateSensors() {
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (!FINGER_PRESENT[i]) {
      rawValues[i] = 4095;
      filteredValues[i] = 4095;
      calibratedValues[i] = 4095;
      bendPercents[i] = 0;
      fingerEnabled[i] = false;
      continue;
    }

    int raw = readAverage(FLEX_PINS[i]);
    rawValues[i] = raw;

    if (!fingerEnabled[i]) {
      filteredValues[i] = 4095;
      calibratedValues[i] = 4095;
      bendPercents[i] = 0;
      continue;
    }

    filteredValues[i] = filteredValues[i] + ALPHA * (raw - filteredValues[i]);

    int cleanValue = (int)filteredValues[i];
    calibratedValues[i] = toCalibratedAdc(i, cleanValue);
    bendPercents[i] = toBendPercent(i, cleanValue);
  }
}

void initializeSensorFilters() {
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (!FINGER_PRESENT[i]) {
      rawValues[i] = 4095;
      filteredValues[i] = 4095;
      calibratedValues[i] = 4095;
      bendPercents[i] = 0;
      fingerEnabled[i] = false;
      continue;
    }

    int raw = readAverage(FLEX_PINS[i]);
    rawValues[i] = raw;
    filteredValues[i] = raw;
    calibratedValues[i] = toCalibratedAdc(i, raw);
    bendPercents[i] = toBendPercent(i, raw);
  }
}

void printSensorLine() {
  Serial.print("raw/cal/bend: ");
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i > 0) Serial.print(" | ");
    Serial.print(FINGER_NAMES[i]);
    Serial.print(" ");
    Serial.print(rawValues[i]);
    Serial.print("/");
    Serial.print(calibratedValues[i]);
    Serial.print("/");
    Serial.print(bendPercents[i]);
    Serial.print("%");
    if (!fingerEnabled[i]) Serial.print(" disabled");
  }
  Serial.println();
}

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Cache-Control", "no-store");
}

void sendJson(int statusCode, const String& body) {
  addCorsHeaders();
  server.send(statusCode, "application/json", body);
}

void handleOptions() {
  addCorsHeaders();
  server.send(204);
}

bool hasWiFiCredentials() {
  return strlen(WIFI_SSID) > 0;
}

void printStateUrl(IPAddress ip) {
  Serial.print("State URL: http://");
  Serial.print(ip);
  Serial.print(":");
  Serial.print(SERVER_PORT);
  Serial.println("/state");
}

void startFallbackAP() {
  apFallbackActive = true;
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  WiFi.softAP(AP_SSID, AP_PASSWORD);

  Serial.println();
  Serial.println("Wi-Fi STA unavailable. Fallback AP started.");
  Serial.print("Wi-Fi AP: ");
  Serial.println(AP_SSID);
  Serial.print("Password: ");
  Serial.println(AP_PASSWORD);
  printStateUrl(WiFi.softAPIP());
}

bool connectToWiFi() {
  if (!hasWiFiCredentials()) {
    Serial.println("WIFI_SSID is empty.");
    return false;
  }

  apFallbackActive = false;
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setHostname(WIFI_HOSTNAME);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println();
  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
    printStateUrl(WiFi.localIP());
    return true;
  }

  Serial.println("Wi-Fi connection failed.");
  WiFi.disconnect(true);
  return false;
}

void setupNetwork() {
  if (!connectToWiFi()) {
    startFallbackAP();
  }
}

void maintainWiFi() {
  if (apFallbackActive || !hasWiFiCredentials()) return;
  if (millis() - lastWiFiCheck < 5000) return;
  lastWiFiCheck = millis();

  if (WiFi.status() == WL_CONNECTED) return;

  Serial.println("Wi-Fi disconnected. Reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void appendFingerObject(String& json, const char* objectName, const int values[]) {
  json += "\"";
  json += objectName;
  json += "\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i > 0) json += ",";
    json += "\"";
    json += FINGER_KEYS[i];
    json += "\":";
    json += values[i];
  }
  json += "}";
}

void appendCalibrationObject(String& json) {
  json += "\"calibration\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i > 0) json += ",";
    json += "\"";
    json += FINGER_KEYS[i];
    json += "\":{\"open\":";
    json += straightValues[i];
    json += ",\"bent\":";
    json += bentValues[i];
    json += ",\"enabled\":";
    json += fingerEnabled[i] ? "true" : "false";
    json += "}";
  }
  json += "}";
}

void appendEnabledObject(String& json) {
  json += "\"enabled\":{";
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i > 0) json += ",";
    json += "\"";
    json += FINGER_KEYS[i];
    json += "\":";
    json += fingerEnabled[i] ? "true" : "false";
  }
  json += "}";
}

String buildStateJson() {
  String json = "{";
  appendFingerObject(json, "sensors", calibratedValues);
  json += ",";
  appendFingerObject(json, "raw", rawValues);
  json += ",";
  appendFingerObject(json, "bendPercent", bendPercents);
  json += ",";
  appendCalibrationObject(json);
  json += ",";
  appendEnabledObject(json);
  json += ",\"calibrating\":";
  json += isCalibrating ? "true" : "false";
  json += ",\"calibratedAt\":";
  json += calibratedAt;
  json += "}";
  return json;
}

void handleState() {
  updateSensors();
  sendJson(200, buildStateJson());
}

bool readCalibrationArg(const String& name, int& value) {
  if (!server.hasArg(name)) return false;

  String text = server.arg(name);
  text.trim();
  if (text.length() == 0) return false;
  for (int i = 0; i < text.length(); i++) {
    char c = text.charAt(i);
    if (c < '0' || c > '9') return false;
  }

  int parsed = text.toInt();
  if (parsed < 0 || parsed > 4095) return false;

  value = parsed;
  return true;
}

void handleSetCalibration() {
  int nextStraight[FINGER_COUNT];
  int nextBent[FINGER_COUNT];
  bool nextEnabled[FINGER_COUNT];

  for (int i = 0; i < FINGER_COUNT; i++) {
    nextStraight[i] = straightValues[i];
    nextBent[i] = bentValues[i];
    nextEnabled[i] = fingerEnabled[i];

    String openName = String(FINGER_KEYS[i]) + "Open";
    String bentName = String(FINGER_KEYS[i]) + "Bent";
    bool hasOpen = server.hasArg(openName);
    bool hasBent = server.hasArg(bentName);

    if (!FINGER_PRESENT[i]) {
      nextStraight[i] = 4095;
      nextBent[i] = 4095;
      nextEnabled[i] = false;
      continue;
    }

    if (!hasOpen && !hasBent) {
      nextStraight[i] = 4095;
      nextBent[i] = 4095;
      nextEnabled[i] = false;
      continue;
    }

    if (hasOpen != hasBent ||
        !readCalibrationArg(openName, nextStraight[i]) ||
        !readCalibrationArg(bentName, nextBent[i]) ||
        abs(nextStraight[i] - nextBent[i]) < MIN_CALIBRATION_RANGE) {
      sendJson(400, "{\"error\":\"invalid calibration values\"}");
      return;
    }

    nextEnabled[i] = true;
  }

  for (int i = 0; i < FINGER_COUNT; i++) {
    straightValues[i] = nextStraight[i];
    bentValues[i] = nextBent[i];
    fingerEnabled[i] = nextEnabled[i];
    filteredValues[i] = fingerEnabled[i] ? readAverage(FLEX_PINS[i]) : 4095;
  }

  calibratedAt = millis();
  updateSensors();
  sendJson(200, buildStateJson());
}

void handleCalibrate() {
  calibrateAllSensors();
  updateSensors();
  sendJson(200, buildStateJson());
}

void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }

  sendJson(404, "{\"error\":\"not found\"}");
}

void setupServer() {
  server.on("/state", HTTP_GET, handleState);
  server.on("/state", HTTP_OPTIONS, handleOptions);
  server.on("/calibrate", HTTP_POST, handleCalibrate);
  server.on("/calibrate", HTTP_OPTIONS, handleOptions);
  server.on("/calibration", HTTP_POST, handleSetCalibration);
  server.on("/calibration", HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);
  server.begin();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  analogReadResolution(12);
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (FINGER_PRESENT[i]) {
      analogSetPinAttenuation(FLEX_PINS[i], ADC_11db);
    }
  }

  Serial.println("FLORTTE GLOVE START");
  Serial.print("Flex pins: ");
  for (int i = 0; i < FINGER_COUNT; i++) {
    if (i > 0) Serial.print(", ");
    Serial.print(FINGER_NAMES[i]);
    Serial.print("=");
    Serial.print(FLEX_PINS[i]);
    if (!FINGER_PRESENT[i]) Serial.print(" (not installed)");
  }
  Serial.println();

  setupNetwork();
  setupServer();

  initializeSensorFilters();
  calibratedAt = millis();

  Serial.println();
  Serial.println("HTTP server is ready.");
  Serial.println("Open the web diagnostics screen and press Calibrate when you are ready.");
  Serial.println("Default calibration is active until manual calibration is saved.");
  Serial.println();
}

void loop() {
  server.handleClient();
  maintainWiFi();

  if (!isCalibrating) {
    updateSensors();
  }

  server.handleClient();

  if (!isCalibrating && millis() - lastSerialPrint >= 250) {
    lastSerialPrint = millis();
    printSensorLine();
  }

  delay(20);
}
