# iTantra Laptop Test Node

A zero-dependency Node.js TCP peer for testing the iTantra Android app without a second phone or Android emulator.

## Requirements

- Node.js 18+ (Node 20+ recommended)
- A phone and laptop connected to the same Wi-Fi network, or the phone's hotspot

## Run

From the repository root:

```powershell
node tools/itantra-test-node/itantra-test-node.js
```

Bun also works:

```powershell
bun tools/itantra-test-node/itantra-test-node.js
```

## Test phone -> laptop

1. Start the test node:

```text
start
```

2. Configure the Android app to connect to the laptop's local IP on port `5555`, if the app is acting as the TCP client.

3. Use the commands below to send test messages back to the phone.

## Test laptop -> phone

If the Android app starts its TCP server on port `5555`, find the phone's local IP and run:

```text
c 192.168.x.x
```

Then use:

```text
r
accept
reject
s Hello from laptop
s नमस्ते फोन
hb
end
```

## Commands

| Command | Action |
|---|---|
| `start` | Listen on TCP port 5555 |
| `c <ip>` | Connect to a phone on port 5555 |
| `r` | Send `call_request` |
| `accept` | Send `call_accept` |
| `reject` | Send `call_reject` |
| `s <text>` | Send `speech_message` |
| `end` | Send `call_end` |
| `hb` | Send `heartbeat` |
| `status` | Show connection status |
| `help` | Show commands |
| `quit` | Exit |

## Protocol compatibility

The node uses the same iTantra framing: JSON followed by `\n`.

It implements the current message types:

- `call_request`
- `call_accept`
- `call_reject`
- `speech_message`
- `call_end`
- `heartbeat`

This tool is intentionally independent of React Native and has no npm dependencies.
