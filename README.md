# Flortte

Flortte is an offline app for a five-finger ESP32 piano glove. The app reads the glove over Bluetooth Low Energy, plays local MIDI files and runs without internet access after installation. The game uses nine supported hand gestures, each with its own reference image.

After every exercise, Flortte stores the success rate, mean timing error (MTE) and timing variability (population standard deviation). Diagnostics shows these metrics for the full session and each finger, then compares MTE with earlier attempts of the same exercise.

## Run locally

Requirements: Node.js 22 or newer and a computer with Bluetooth enabled.

```bash
npm ci
npm start
```

## Build installers in GitHub Actions

Open Actions, select `Build installers`, then select `Run workflow`. The workflow produces four downloadable artifacts:

- `Flortte-Windows`, an EXE installer for Windows x64.
- `Flortte-Android`, an installable debug APK.
- `Flortte-macOS`, a universal DMG for Intel and Apple silicon Macs.
- `Flortte-iPhone-unsigned`, an unsigned IPA. Sign it with an Apple Developer certificate before installing it on an iPhone.

The same workflow runs for pull requests to `main` and version tags such as `v1.1.0`.

Local desktop builds:

```bash
npm ci
npm run build:win
npm run build:mac
```

## Application icon

Keep the source icon at `build/icon.ico`. Windows uses it directly. GitHub Actions converts it into the macOS, iPhone and Android icon formats during each build. Use a square, transparent, multi-resolution ICO containing at least 16, 32, 48, 128 and 256 pixel variants.

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
