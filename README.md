# iTantra

iTantra is an offline, low bitrate communication system designed for voice and text communication over local networks. It is being developed for SIH Hackathon 2026 with a focus on Indian multilingual speech communication where internet connectivity may be unavailable or unreliable.

## Overview

The application allows nearby Android devices to discover each other and communicate directly over a local Wi Fi network or mobile hotspot.

The communication path is local and does not require an internet connection once the application and required offline speech models are available.

Core capabilities include:

• Local device discovery
• Direct TCP communication
• Voice call request and acceptance flow
• Speech to text using Android on device speech recognition
• Text to speech using the device speech engine
• Text messaging over the local network
• Heartbeat based connection maintenance
• Background discovery support for incoming communication requests

## Architecture

```text
Android Phone A
      |
      | Local Wi Fi / Hotspot
      |
      v
Device Discovery
      |
      | TCP
      v
Android Phone B
      |
      +--> Speech to Text
      |
      +--> Text to Speech
      |
      +--> Local Communication
```

Discovery uses UDP independent local discovery logic through TCP based scanning. The application first checks the discovery service on port `5556` and can fall back to a TCP probe on port `5555`.

Communication uses TCP on port `5555`.

Messages are transferred as newline delimited JSON objects. Supported message types include:

• `call_request`
• `call_accept`
• `call_reject`
• `speech_message`
• `call_end`
• `heartbeat`

## Technology Stack

• React Native
• Expo SDK 57
• TypeScript
• Expo Router
• NativeWind
• `react-native-tcp-socket`
• `@react-native-community/netinfo`
• `react-native-device-info`
• `expo-speech-recognition`
• `expo-speech`

## Project Structure

```text
src/
├── app/
│   └── Application screens and navigation
├── context/
│   └── CommunicationContext.tsx
├── screens/
│   └── AvailableDevicesScreen.tsx
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

android/
└── Native Android background service and platform configuration

tools/
└── itantra-test-node/
    └── Local laptop test node for TCP and discovery testing
```

## How Communication Works

### 1. Device discovery

When iTantra starts, it identifies the device's local network address and starts a discovery service.

The application scans the local subnet for other iTantra devices. A discovered device is added to the available devices list with its IP address and TCP communication port.

### 2. Connection

When a user selects a device, iTantra creates a TCP connection to that device on port `5555`.

The application then sends a `call_request` message.

### 3. Call acceptance

The receiving device can accept or reject the request.

When accepted, both devices enter the communication screen and maintain the TCP connection with heartbeat messages.

### 4. Speech communication

The sender's speech is converted to text using Android on device speech recognition. The resulting text is sent through the TCP connection.

The receiving device displays the message and can convert the received text back into speech using text to speech.

```text
Voice
  ↓
Offline Speech Recognition
  ↓
Text
  ↓
TCP / Local Network
  ↓
Text
  ↓
Text to Speech
  ↓
Voice
```

## Offline Speech Recognition

On Android, iTantra requests on device speech recognition through Android System Intelligence.

An offline language model must be installed on the Android device for speech recognition to work without internet access.

If no suitable offline model is installed, speech recognition will report that an offline speech model is unavailable.

The current default recognition locale is `en-US`, while the implementation can select an installed locale when available.

## Running the Project

Install dependencies:

```bash
npm install
```

Start the Expo development server:

```bash
npm start
```

Because iTantra uses native modules such as TCP sockets and speech recognition, use a native Android development build rather than relying only on Expo Go.

Build and run on Android:

```bash
npx expo run:android
```

For a release variant:

```bash
npx expo run:android --variant release
```

## Testing With Two Android Phones

The recommended test setup is two real Android phones connected to the same local network.

### Wi Fi router test

1. Connect both phones to the same Wi Fi network.
2. Install the iTantra development build on both phones.
3. Open iTantra on both devices.
4. Check the Available Devices screen.
5. Confirm that each phone can discover the other.
6. Send a call request from one phone.
7. Accept the request on the other phone.
8. Test text and speech communication.

### Mobile hotspot test

One phone can create a mobile hotspot while the second phone connects to it.

The direction of the hotspot can matter because some Android hotspot implementations restrict communication between connected clients. Testing both directions helps distinguish application issues from network restrictions.

## Laptop Test Node

The repository includes a lightweight Node.js test node for testing TCP communication and discovery without requiring a second phone.

Start it with:

```bash
npm tools/itantra-test-node/itantra-test-node.js
```

The test node listens on:

```text
TCP communication: 5555
Device discovery:   5556
```

It can be used to test connection requests, acceptance, rejection, speech messages, call termination, heartbeat messages, and device discovery.

The laptop test node is useful for development, but two real Android devices are the preferred environment for validating Android to Android networking.

## Network Requirements

Both devices must be able to reach each other over the local network.

Typical requirements are:

• Same Wi Fi network or compatible mobile hotspot
• Local IPv4 connectivity
• TCP port `5555` reachable for communication
• TCP port `5556` reachable for primary discovery
• Android network permissions enabled

A device may have a different IP address on each network. This is normal. The important requirement is that the devices can reach each other on the same local network.

## Android Background Behavior

iTantra includes a native Android foreground service for maintaining discovery while the application is in the background.

The service is intended to allow a device to remain discoverable for incoming communication requests when the application is not actively visible.

Android may still restrict background activity in situations such as force stopping the application or applying system level battery restrictions.

## Current Development Status

Implemented:

• Android application foundation
• Local network discovery
• TCP server and client communication
• TCP message framing
• Call request and response flow
• Text messaging
• Speech to text integration
• Offline Android speech recognition support
• Text to speech
• TCP heartbeat
• Android background discovery service
• Laptop based TCP and discovery test node

The current development focus is validating reliable Android to Android communication across normal Wi Fi networks and mobile hotspot configurations.

## Hackathon Context

iTantra is being developed for ESH Hackathon 2026 as an Indian multilingual TTS and STT communication system for low bitrate local links.

The project aims to demonstrate how speech based communication can continue to function in environments where conventional internet based communication is unavailable, unreliable, or unsuitable.

## License

This project is currently under development for hackathon and research purposes.
