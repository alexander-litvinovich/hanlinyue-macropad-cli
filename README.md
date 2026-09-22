# Hanlinyue macropad CLI

Program a Hanlinyue Free2 or Free3 macro keyboard over USB serial.

Close `hanlinyue.app` first. Only one process can hold the device port.

## Install

```bash
npm install -g github:alexander-litvinovich/hanlinyue-macropad-cli
```

For a local checkout:

```bash
npm install
npm link
```

## Set text to type

Run the command with no subcommand:

```bash
macropad-cfg
```

The editor detects the connected model when it can, then lets you edit text
with arrow keys, Backspace, Delete, Home, and End. It updates each key's event
budget as you type. Press Enter to confirm the write, or Esc or Ctrl+C to quit.

Every physical key supports at most 5 presses. A normal character is one
press. Consecutive shifted characters share one additional Shift press.

The event stream includes a wait between presses, so it has
`4 × presses − 1` events. A full five-press key contains 19 events. Free2 has
two keys and Free3 has three. The editor refuses empty text and text that
needs more keys than the device has.

The 5-press ceiling comes from writing to hardware rather than from any
published spec. Set `MACROPAD_MAX_PRESSES` to try a different one.

The editor never stores your text locally. The documented device protocol does
not include a command to read the current key config.

Use `--model` if automatic model detection does not work:

```bash
macropad-cfg --model Free3
```

For scripts, bypass the editor:

```bash
macropad-cfg type "Hello"
macropad-cfg --model Free3 type "qwertyuiopq"
```

`type` validates the same press budget and splits the text across keys.

## Other commands

These commands are for less common operations:

```bash
macropad-cfg list
macropad-cfg info
macropad-cfg preset keyboard_ud
macropad-cfg macro -k 1 -m "qwert"
macropad-cfg raw '{"o":"set","k":1,"m":"mouse","e":"click","v":"home","r":1}'
```

`macro` writes one key and therefore also has a 15-event limit. `raw` sends
an unchecked JSON command for device functions the interactive editor does not
cover.

When exactly one matching device is connected, `--port` is optional. On macOS,
the CLI prefers `/dev/cu.*` over `/dev/tty.*`.

## Development

```bash
npm test
npm run typecheck
npm run build
```
