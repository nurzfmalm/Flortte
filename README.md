# Flortte

Flortte is an offline Windows app for a five-finger ESP32 piano glove. The app reads the glove over Bluetooth Low Energy, plays local MIDI files and runs without internet access after installation.

## Run locally

Requirements: Node.js 22 or newer and Windows 10 or 11 with Bluetooth enabled.

```bash
npm ci
npm start
```

## Build the Windows installer

```bash
npm ci
npm run build:win
```

The installer is written to `dist/Flortte-Setup-1.1.0.exe`. GitHub Actions also builds the installer when a version tag such as `v1.1.0` is pushed or when the Windows build workflow is started manually.

## ESP32 glove

Flash `arduino/FlortteGloveESP32/FlortteGloveESP32.ino`. The firmware publishes five sensor values through the `FlortteGlove` BLE service.

| Finger | ESP32 pin | App test key |
| --- | ---: | --- |
| Thumb | 32 | A |
| Index | 33 | S |
| Middle | 34 | D |
| Ring | 35 | F |
| Little | 25 | G |

Open Diagnostics after connecting the glove. Run calibration with all five fingers, then adjust each finger's bend and release thresholds if needed.
