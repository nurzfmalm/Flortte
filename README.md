# Flortte

Flortte is an offline Windows app for a five-finger ESP32 piano glove. The app reads the glove over Bluetooth Low Energy, plays local MIDI files and runs without internet access after installation. The game uses nine supported hand gestures, each with its own reference image.

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

## Application icon

Put the Windows icon at `build/icon.ico`. Electron Builder will use it for the application, installer and shortcuts during the next `npm run build:win` build. Use a square, transparent, multi-resolution ICO containing at least 16, 32, 48, 128 and 256 pixel variants.

## ESP32 glove

Flash `arduino/FlortteGloveESP32/FlortteGloveESP32.ino`. The firmware publishes five sensor values through the `FlortteGlove` BLE service.

| Finger | ESP32 pin | App test key |
| --- | ---: | --- |
| Thumb | 32 | A |
| Index | 33 | S |
| Middle | 34 | D |
| Ring | 35 | F |
| Little | 25 | G |

Open Settings to connect and calibrate the glove or adjust each finger's bend and release thresholds. Open Diagnostics to run the guided hardware test for every finger.
