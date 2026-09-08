# iTantra MVP Implementation Summary

## Completed Components

### 1. Network Layer (`src/services/network/`)

- **tcpService.ts** - TCP socket management (server/client)
  - Start server on port 5555
  - Connect to remote devices
  - Send/receive messages with proper cleanup

- **messageProtocol.ts** - Message framing
  - JSON messages with newline delimiters
  - Handles split messages and buffer management

- **deviceDiscovery.ts** - Device management
  - Stale device cleanup (10s timeout)
  - Device tracking with timestamps

### 2. Speech Services (`src/services/speech/`)

- **speechToText.ts** - Android STT integration
  - Uses react-native-voice
  - English language support
  - One-time speech capture with `listenForSpeech()`

- **textToSpeech.ts** - Android TTS integration
  - Uses react-native-tts
  - Auto-play received messages
  - Proper lifecycle management

### 3. State Management (`src/context/`)

- **CommunicationContext.tsx**
  - Global app state (devices, call state, messages)
  - Handles incoming/outgoing calls
  - Message routing between TCP and UI
  - STT/TTS coordination

### 4. UI Components (`src/screens/` and `src/components/`)

- **AvailableDevicesScreen.tsx**
  - Device list display
  - Manual device addition (by IP)
  - Call initiation
  - Loading states

- **CommunicationScreen.tsx**
  - Message history (chat-like UI)
  - Push-to-talk microphone button
  - Auto-play incoming messages
  - End call functionality

- **IncomingCallModal.tsx**
  - Displays incoming call notifications
  - Accept/Reject buttons

### 5. Navigation

- Expo Router with stack navigation
- Dynamic screen switching based on call state
- Clean modal handling for incoming calls

## Message Protocol

All TCP messages use this format:

```json
{ "type": "...", ...fields }\n
```

Message types:

- `call_request` - Initiate a call
- `call_accept` - Accept incoming call
- `call_reject` - Reject incoming call
- `speech_message` - Send chat text
- `call_end` - End the call

## How to Test

### Setup

1. **Build the development APK:**

   ```bash
   bun expo prebuild --clean --platform android
   bun expo build:android --development-client --local
   ```

2. **Install on two devices:**
   - Install the APK on both Android phones
   - Both should be on the same Wi-Fi network

### Testing Flow

#### Phone A:

1. Launch app - shows "Available Devices"
2. Tap "+ Add" button
3. Enter:
   - Device Name: "Phone B"
   - Device IP: (get from Phone B)
4. Tap "Add & Call"
5. App shows "Calling..." while TCP connection establishes

#### Phone B:

1. Launch app - shows "Available Devices"
2. In device settings, find local IP address (Settings → Wi-Fi)
3. Wait for incoming call modal
4. Tap ✓ to accept
5. Both phones now in "Communication Screen"

#### Communication:

1. **Phone A speaks:**
   - Hold down 🎙 button
   - Say "Hello"
   - Release button
   - Text appears in chat
   - Phone B receives text over TCP
   - Phone B auto-plays text using TTS

2. **Phone B responds:**
   - Hold down 🎙 button
   - Say "Hi there"
   - Release button
   - Same flow in reverse

3. **End call:**
   - Either phone taps "End Call"
   - Both return to Available Devices screen

## Architecture Notes

### No Internet Required

- All communication stays on local Wi-Fi
- TCP on port 5555
- No backend services
- No cloud APIs

### Offline Speech

- Android STT: Device-local recognition
- Android TTS: Device-local synthesis
- No cloud speech APIs

### Future Enhancements

- Automatic device discovery (mDNS/Bluetooth)
- Multiple participants
- Message persistence
- Multilingual support (when replacing STT/TTS)
- Video call capability

## Permissions Required

Declared in `app.json`:

- `RECORD_AUDIO` - For microphone/STT
- `INTERNET` - For local TCP (local network access)
- `ACCESS_NETWORK_STATE` - For network detection
- `CHANGE_NETWORK_STATE` - For network state checks

These are requested at runtime on Android 6+.

## Known Limitations (MVP)

1. **Device Discovery:** Manual IP entry required
   - Automatic discovery can be added later with mDNS

2. **Single Active Call:** One call at a time
   - Multi-party requires additional architecture

3. **Message Delivery:** No retry mechanism
   - Fine for LAN; add retry/acknowledgment for reliability

4. **Call Timeout:** No auto-timeout after inactivity
   - Can be added with heartbeat messages

## File Structure

```
src/
├── app/
│   ├── _layout.tsx (Root with context provider)
│   ├── index.tsx (Navigation logic)
│   └── communication.tsx (Communication screen route)
├── screens/
│   ├── AvailableDevicesScreen.tsx
│   └── CommunicationScreen.tsx
├── components/
│   └── IncomingCallModal.tsx
├── context/
│   └── CommunicationContext.tsx
├── services/
│   ├── network/
│   │   ├── tcpService.ts
│   │   ├── messageProtocol.ts
│   │   └── deviceDiscovery.ts
│   └── speech/
│       ├── speechToText.ts
│       └── textToSpeech.ts
└── types/
    └── communication.ts
```

## Testing Checklist

- [ ] App builds without errors
- [ ] App launches on Android device
- [ ] Available Devices screen displays
- [ ] Can add device by IP
- [ ] TCP server starts on port 5555
- [ ] Phone A can initiate call to Phone B
- [ ] Phone B receives call request (modal appears)
- [ ] Phone B can accept call
- [ ] Communication screen appears on both phones
- [ ] Microphone button responds to press
- [ ] STT recognizes speech
- [ ] Text appears in chat
- [ ] TCP transmits message
- [ ] Other phone receives message
- [ ] TTS plays received message
- [ ] Both directions work
- [ ] End Call button disconnects properly
- [ ] No crashes on disconnect

## Troubleshooting

**"No devices found":**

- Make sure both phones are on same Wi-Fi
- Use "+ Add" to manually enter IP address

**"Call failed":**

- Check phone B is running the app
- Verify IP address is correct
- Check phones can ping each other

**"No audio during TTS:"**

- Ensure volume is not muted
- Check phone isn't in silent mode
- Verify TTS is initialized properly

**"STT not working:"**

- Ensure microphone permission granted
- Check device supports speech recognition
- Try again - recognition can be inconsistent

**"TCP connection refused":**

- Phone B must have app running
- Check port 5555 isn't blocked by firewall
- Verify local network connectivity
