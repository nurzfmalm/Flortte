# Windows application icon

Place the final logo here with this exact name:

`build/icon.ico`

The next `npm run build:win` build will use it for the application, installer, desktop shortcut and Start menu shortcut. No code change is required.

Recommended ICO contents:

- rounded square artwork that fills the full canvas without outer padding
- transparent pixels only in the rounded corners
- 16×16, 24×24, 32×32, 48×48, 64×64, 128×128 and 256×256 variants
- true-color RGBA, with the 256×256 variant stored as PNG inside the ICO
