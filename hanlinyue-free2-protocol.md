# Hanlinyue Free2 Protocol Notes

## Firmware V0.15 — Correct Protocol (2026-06-18)

### Wire format (from deployed app's protocol-ae7b76ef.js):
- Keyboard: `{o:"set", k:1, m:"keyboard", e:"click", v:[events], r:1}`
- Mouse/Phone: `{o:"set", k:1, m:"mouse", e:"click", v:"slideup", r:1}`
- Script/Macro: `{o:"set", k:1, m:"script", e:"click", v:[events], r:repeat}`
- Preset: `{o:"set", m:"preset", v:"keyboard_ud"}`
- GET: `{o:"get", t:"model"|"battery"|"firmware"|"mac"}`

### Field mapping (source ≠ deployed app!):
- `e` = layer (click/doubleclick/longpress) — NOT `l`
- `r` = repeat count (default 1) — missing in old source
- `m:"mouse"` = phone/touch actions — NOT `"phone"`
- `m:"script"` = macro/script mode — NOT `"macro"`

### Segmentation:
- Commands >64B need S-header segmentation: `S{seq}[{i}/{total}]` + 55B payload
- Sequence cycles 1–9
- Segments sent sequentially via serial port.write() + drain(), 10ms delay between segments
- Commands ≤64B sent directly without header
- Warmup required: send a small query (e.g. model GET) before segmented commands to prime the serial interface after port open

### Transport:
- Serial: /dev/cu.usbmodem31303, 460800 baud, 8-N-1
- USB direct writes don't work (no DTR without kernel serial driver)
- 300ms settle after commands before port close
- Device needs warmup after port reconnection — first segmented command after fresh port open fails without a prior non-segmented write

### Key lessons:
- The extracted source code uses DIFFERENT field names than the deployed app
- Source uses `l`, `"phone"`, `"macro"` — deployed uses `e`, `"mouse"`, `"keyboard"` (for both shortcuts AND macros)
- `m:"script"` is defined in the protocol but NEVER USED by the app — everything key-based uses `m:"keyboard"`
- Always trust the deployed/compiled code (`public/dist/`), not source repos (`hanlinyue-web/src/`)
- Compiled ScriptView calls `F.setKeyboard(keyIndex, layer, events, repeat)` — confirmed via `Script-8bdbcfa0.js`

### Serialport write behavior:
- The deployed app (SerialPortManager.js) keeps the port open persistently (Electron app, never closes)
- The deployed app just calls port.write(data, cb) with no drain or delays — works because port stays open
- CLI MUST use drain per segment: without drain, port.close() discards buffered data
- CLI MUST add a small inter-segment delay (~10ms): without it, USB driver gets overwhelmed and drain hangs
- drain() after ALL writes at once (no per-segment drain) hangs forever (~10 minutes!) because device USB-resets after receiving complete command
- 50ms inter-segment delay works for short macros but exceeds device's reassembly timeout for long ones (26 segments × 53ms = 1378ms)
- 10ms delay: 26 segments × ~13ms = ~340ms — fast enough for reassembly, slow enough for USB driver
- drain timeout (200ms) is safety net — drain normally completes in 0-3ms per segment
- SIGKILL (3s) needed because drain handles block natural process exit for long macros
- SIGKILL at <1s corrupts macOS serial port state, requiring device replug

### Macro event format (from MacroRecorder.vue):
- App records browser KeyboardEvent: `{t:"down", k:event.key, c:event.keyCode}`
- For shifted chars (e.g. @): k="@", c=50 (physical key code), with separate Shift down/up events
- App's command size limit: 150KB (checked in ScriptView, way above CLI usage)
