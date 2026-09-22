# Hanlinyue Free2 CLI

Terminal utility for programming a Hanlinyue Free2 macro keyboard over USB serial.

Uses the same transport as the official Electron app:

- USB Serial VID `4C4A`, PID `4155`
- Baud rate `460800`
- UTF-8 JSON commands, fragmented into `S1[1/N]…` packets when longer than 64 bytes
- A warmup query is sent before segmented writes to prime the device after port reconnection
- 50 ms inter-segment delay, 300 ms post-command settle

Close `hanlinyue.app` before using the CLI — only one process can own the serial port.

## Install

```bash
npm install
npm link
```

Or run directly:

```bash
node src/cli.js list
```

## Commands

### List ports

```bash
hanlinyue-free2 list
```

### Device info

```bash
hanlinyue-free2 info
```

### Apply a preset

```bash
hanlinyue-free2 preset keyboard_ud
```

### Write a macro

```bash
hanlinyue-free2 macro -k 1 -m "ab"
hanlinyue-free2 macro -k 2 -m "cd"
hanlinyue-free2 macro -k 1 -m "hello@world#123"
```

Supported characters: `a`–`z`, `A`–`Z`, `0`–`9`, space, and punctuation
including shifted symbols (`!@#$%^&*()_+{}|:"<>?`) and unshifted ones
(`` ~-=[]\;',./  ``). Shifted characters automatically emit Shift key events.

Macro options:

- `-k, --key <1|2>` — target key
- `-m, --macro <text>` — text to type
- `-d, --delay <ms>` — delay between key events (default `30`)
- `--repeat <n|forever>` — repeat count (default `1`)
- `--layer <click|doubleclick|longpress>` — target layer (default `click`)

### Type a string across both keys

```bash
hanlinyue-free2 type "Hello"
hanlinyue-free2 type "QWERTY"
hanlinyue-free2 type "Hello World!"
```

The device supports a maximum of 5 key presses per button macro. The `type`
command optimizes shift usage (grouping consecutive shifted characters under a
single Shift hold) and automatically splits the string across key 1 and key 2
when it overflows.

Press budget per key: each character costs 1 press; each shifted group adds 1
press for the Shift modifier. Examples:

- `"qwert"` → 5 presses → key 1 only
- `"QWER"` → shift + 4 letters = 5 presses → key 1 only
- `"Hello"` → shift+H + e,l,l = 5 on key 1; o on key 2
- `"qwerty"` → 5 on key 1, 1 on key 2

An error is reported if the text requires more than 2 keys.

Type options:

- `-d, --delay <ms>` — delay between key events (default `30`)
- `--repeat <n|forever>` — repeat count (default `1`)
- `--layer <click|doubleclick|longpress>` — target layer (default `click`)

### Apply a profile

```bash
hanlinyue-free2 apply examples/free2-profile.yaml
```

Use `apply` when setting both keys — it sends all commands in a single port
session which is more reliable than separate invocations.

### Send raw JSON

```bash
hanlinyue-free2 raw '{"o":"get","t":"model"}'
```

### Port selection

When exactly one matching device is connected, `--port` is optional.
Use `--port` when multiple devices are present:

```bash
hanlinyue-free2 --port /dev/cu.usbmodem31303 macro -k 1 -m "hello"
```

On macOS the CLI automatically prefers `/dev/cu.*` over `/dev/tty.*`.

## Free2 Presets

- `pageturn_android`
- `keyboard_lr`
- `keyboard_pud`
- `keyboard_cv`
- `mouse_1`
- `mouse_2`
- `keyboard_ud`
- `mouse_3`

## Profile Format

```yaml
model: Free2
keys:
  - key: 1
    layer: click
    type: keyboard
    shortcut: [Control, C]
  - key: 2
    layer: click
    type: phone
    action: swipe_up
```

Supported types: `keyboard`, `phone`, `macro`.

Supported layers: `click`, `doubleclick`, `longpress`.

### Keyboard entries

Use `shortcut` for key combos or raw `events` for full control:

```yaml
- key: 1
  layer: click
  type: keyboard
  shortcut: [Control, C]

- key: 2
  layer: doubleclick
  type: keyboard
  events:
    - { t: down, k: A, c: 65 }
    - { t: wait, ms: 10 }
    - { t: up, k: A, c: 65 }
```

### Phone (touch) actions

```yaml
- key: 2
  layer: click
  type: phone
  action: swipe_up
```

Actions: `like`, `lockscreen`, `speed`, `slideleft`, `slideright`, `slideup`,
`slidedown`, `pause`, `back`, `home`.

Aliases: `swipe_up`, `swipe_down`, `swipe_left`, `swipe_right`.

### Macros

```yaml
- key: 1
  layer: longpress
  type: macro
  repeat: 2
  events:
    - { t: down, k: A, c: 65 }
    - { t: wait, ms: 20 }
    - { t: up, k: A, c: 65 }
```

`repeat` can be a positive integer or `forever`.

### Shift positions

Some firmware modes have physical switch positions (`P`, `M`, `R`):

```yaml
- key: 1
  layer: click
  shifts: [P, M, R]
  type: phone
  action: home
```

## Test

```bash
npm test
```
