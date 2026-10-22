# Ready Library for Windows and macOS — bundled runtime

The desktop app wraps the web app (see the other files in this folder for its fonts, icons and adapted code) in:

- **Electron** 44.8.0 — MIT License, © Electron contributors, © GitHub Inc. <https://github.com/electron/electron>
- **Chromium** and the libraries it includes, under their own licences, listed in `LICENSES.chromium.html` inside the app
  bundle (`Ready Library.app/Contents/Frameworks/Electron Framework.framework/Resources/` on macOS,
  beside `Ready Library.exe` on Windows).
- **fflate** 0.8 — MIT License, © Arjun Barrett (bundled into the app's local API, `Resources/server/server.mjs`).

`scripts/adhoc-sign.cjs` is taken from Ready Poster Printer's desktop app (same author).
