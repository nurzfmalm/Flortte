const int flexPin = 32;
const int buttonPin = 0; // IO0 / BOOT

int bentValue = 0;
int straightValue = 0;

float filtered = 0;

const float alpha = 0.12;
const int samples = 25;
const int deadZone = 3;

int readAverage() {
  long sum = 0;

  for (int i = 0; i < samples; i++) {
    sum += analogRead(flexPin);
    delay(2);
  }

  return sum / samples;
}

void waitForButtonPress() {
  while (digitalRead(buttonPin) == HIGH) {
    delay(10);
  }

  delay(50);

  while (digitalRead(buttonPin) == LOW) {
    delay(10);
  }

  delay(200);
}

void calibrateSensor() {
  Serial.println();
  Serial.println("CALIBRATION START");
  Serial.println("1) Bend flex sensor to MAXIMUM");
  Serial.println("2) Press IO0 / BOOT");

  waitForButtonPress();

  bentValue = readAverage();

  Serial.print("Bent value saved: ");
  Serial.println(bentValue);

  Serial.println();
  Serial.println("3) Straighten flex sensor");
  Serial.println("4) Press IO0 / BOOT again");

  waitForButtonPress();

  straightValue = readAverage();

  Serial.print("Straight value saved: ");
  Serial.println(straightValue);

  int range = abs(straightValue - bentValue);

  Serial.print("Range: ");
  Serial.println(range);

  if (range < 20) {
    Serial.println("Range too small. Calibrate again.");
    delay(1000);
    calibrateSensor();
    return;
  }

  filtered = readAverage();

  Serial.println();
  Serial.println("CALIBRATION DONE");
  Serial.println("Reading data...");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(buttonPin, INPUT_PULLUP);

  analogReadResolution(12);
  analogSetPinAttenuation(flexPin, ADC_11db);

  Serial.println("START");

  calibrateSensor();
}

void loop() {
  int raw = readAverage();

  filtered = filtered + alpha * (raw - filtered);

  int cleanValue = (int)filtered;

  int bendPercent;

  if (bentValue < straightValue) {
    bendPercent = map(cleanValue, straightValue, bentValue, 0, 100);
  } else {
    bendPercent = map(cleanValue, straightValue, bentValue, 0, 100);
  }

  bendPercent = constrain(bendPercent, 0, 100);

  if (bendPercent < deadZone) {
    bendPercent = 0;
  }

  Serial.print("raw: ");
  Serial.print(raw);

  Serial.print(" | filtered: ");
  Serial.print(cleanValue);

  Serial.print(" | bend: ");
  Serial.print(bendPercent);

  Serial.println("%");

  delay(50);
}