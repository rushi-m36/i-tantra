#!/usr/bin/env node
'use strict';

const net = require('node:net');
const readline = require('node:readline');
const crypto = require('node:crypto');

const PORT = 5555;
const DISCOVERY_PORT = 5556;
const DEFAULT_NAME = 'Laptop Test Node';
const DEVICE_ID = 'laptop-test-node';

let socket = null;
let server = null;
let discoveryServer = null;
let buffer = '';
let connectedPeer = null;

function now() {
  return Date.now();
}

function send(message) {
  if (!socket || socket.destroyed) {
    console.log('\nNot connected. Start the server or connect to the phone first.');
    return;
  }

  const wire = JSON.stringify(message) + '\n';
  socket.write(wire, 'utf8');
  console.log(`\n[SEND] ${JSON.stringify(message)}`);
}

function handleData(data) {
  buffer += data.toString('utf8');

  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line);
      console.log(`\n[RECV] ${JSON.stringify(message, null, 2)}`);
    } catch (error) {
      console.log(`\n[RECV RAW] ${line}`);
      console.log(`[WARN] Invalid JSON: ${error.message}`);
    }
  }

  prompt();
}

function attachSocket(newSocket) {
  if (socket && socket !== newSocket && !socket.destroyed) {
    socket.destroy();
  }

  socket = newSocket;
  buffer = '';
  connectedPeer = `${newSocket.remoteAddress}:${newSocket.remotePort}`;

  console.log(`\nConnected to ${connectedPeer}`);

  newSocket.setEncoding('utf8');
  newSocket.on('data', handleData);
  newSocket.on('error', (error) => {
    console.log(`\nSocket error: ${error.message}`);
  });
  newSocket.on('close', () => {
    if (socket === newSocket) {
      socket = null;
      connectedPeer = null;
      buffer = '';
    }
    console.log('\nConnection closed.');
    prompt();
  });
}

function startServer() {
  if (server) {
    console.log(`Server is already listening on ${PORT}.`);
    return;
  }

  server = net.createServer(attachSocket);
  server.on('error', (error) => {
    console.error(`\nServer error: ${error.message}`);
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nTCP server listening on 0.0.0.0:${PORT}`);
    console.log('Your phone can connect to this laptop on TCP port 5555.');
    prompt();
  });
}

function startDiscoveryServer() {
  if (discoveryServer) {
    console.log(`Discovery server is already listening on ${DISCOVERY_PORT}.`);
    return;
  }

  discoveryServer = net.createServer((client) => {
    let requestBuffer = '';
    const remote = `${client.remoteAddress}:${client.remotePort}`;
    console.log(`\n[DISCOVERY] Request from ${remote}`);

    client.setEncoding('utf8');
    client.on('data', (data) => {
      requestBuffer += data;
      if (!requestBuffer.includes('\n')) return;

      const request = requestBuffer.split('\n')[0].trim();
      if (request !== 'ITANTRA_DISCOVER_V1') {
        console.log(`[DISCOVERY] Ignored unknown request: ${request}`);
        client.destroy();
        return;
      }

      const response = {
        magic: 'ITANTRA_DISCOVER_V1',
        id: DEVICE_ID,
        name: DEFAULT_NAME,
        port: PORT,
      };

      client.write(JSON.stringify(response) + '\n', 'utf8', () => {
        console.log(`[DISCOVERY] Sent device info to ${remote}`);
        client.destroy();
      });
    });

    client.on('error', (error) => {
      console.log(`[DISCOVERY] Client error: ${error.message}`);
    });
  });

  discoveryServer.on('error', (error) => {
    console.error(`\nDiscovery server error: ${error.message}`);
    if (error.code === 'EADDRINUSE') {
      console.error(`Discovery port ${DISCOVERY_PORT} is already in use.`);
    }
  });

  discoveryServer.listen(DISCOVERY_PORT, '0.0.0.0', () => {
    console.log(`\nDiscovery server listening on 0.0.0.0:${DISCOVERY_PORT}`);
    console.log('Phones can now discover this laptop as an iTantra device.');
    prompt();
  });
}

function stopDiscoveryServer() {
  if (!discoveryServer) {
    console.log('Discovery server is not running.');
    return;
  }

  discoveryServer.close(() => {
    console.log('Discovery server stopped.');
  });
  discoveryServer = null;
}

function connectToPhone(host) {
  if (!host) {
    console.log('Usage: c <phone-ip>');
    return;
  }

  if (socket && !socket.destroyed) socket.destroy();

  const client = net.createConnection({ host, port: PORT }, () => {
    attachSocket(client);
    console.log(`Connected to phone at ${host}:${PORT}`);
    prompt();
  });

  client.setTimeout(10000);
  client.on('timeout', () => {
    console.log('\nConnection timed out.');
    client.destroy();
  });
  client.on('error', (error) => {
    console.log(`\nCould not connect to ${host}:${PORT}: ${error.message}`);
    prompt();
  });
}

function callRequest() {
  send({
    type: 'call_request',
    senderId: DEVICE_ID,
    senderName: DEFAULT_NAME,
    timestamp: now(),
  });
}

function callAccept() {
  send({
    type: 'call_accept',
    senderId: DEVICE_ID,
    timestamp: now(),
  });
}

function callReject() {
  send({
    type: 'call_reject',
    senderId: DEVICE_ID,
    timestamp: now(),
  });
}

function speech(text) {
  if (!text) {
    console.log('Usage: s <text>');
    return;
  }

  send({
    type: 'speech_message',
    id: crypto.randomUUID(),
    senderId: DEVICE_ID,
    text,
    timestamp: now(),
  });
}

function callEnd() {
  send({
    type: 'call_end',
    senderId: DEVICE_ID,
    timestamp: now(),
  });
}

function heartbeat() {
  send({
    type: 'heartbeat',
    senderId: DEVICE_ID,
    timestamp: now(),
  });
}

function status() {
  console.log(`\nTCP server: ${server ? 'running on :5555' : 'stopped'}`);
  console.log(`Discovery server: ${discoveryServer ? 'running on :5556' : 'stopped'}`);
  console.log(`Connection: ${socket && !socket.destroyed ? 'connected' : 'not connected'}`);
  if (connectedPeer) console.log(`Peer: ${connectedPeer}`);
}

function help() {
  console.log(`
Commands
--------
start                 Start laptop TCP server on port 5555
discovery             Start laptop iTantra discovery server on port 5556
stop-discovery        Stop discovery server
c <phone-ip>          Connect to a phone running iTantra TCP server
r                     Send call_request
accept                Send call_accept
reject                Send call_reject
s <text>              Send speech_message
end                   Send call_end
hb                    Send heartbeat
status                Show server/connection status
help                  Show this help
quit                  Exit

Discovery test
--------------
discovery
Then open iTantra on the phone connected to the same Wi-Fi/hotspot.
The phone should find "Laptop Test Node" automatically.

Communication test
------------------
start
c 192.168.43.123
r
s Hello from the laptop
s नमस्ते फोन
hb
end
`);
}

function handleCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const [command, ...rest] = trimmed.split(' ');
  const argument = rest.join(' ').trim();

  switch (command.toLowerCase()) {
    case 'start':
      startServer();
      break;
    case 'discovery':
      startDiscoveryServer();
      break;
    case 'stop-discovery':
      stopDiscoveryServer();
      break;
    case 'c':
    case 'connect':
      connectToPhone(argument);
      break;
    case 'r':
    case 'request':
      callRequest();
      break;
    case 'accept':
      callAccept();
      break;
    case 'reject':
      callReject();
      break;
    case 's':
    case 'speech':
      speech(argument);
      break;
    case 'end':
      callEnd();
      break;
    case 'hb':
    case 'heartbeat':
      heartbeat();
      break;
    case 'status':
      status();
      break;
    case 'help':
    case '?':
      help();
      break;
    case 'quit':
    case 'exit':
      shutdown();
      break;
    default:
      console.log(`Unknown command: ${command}. Type help.`);
  }
}

function prompt() {
  rl.prompt();
}

function shutdown() {
  if (socket && !socket.destroyed) socket.destroy();
  if (server) server.close();
  if (discoveryServer) discoveryServer.close();
  rl.close();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'itantra> ',
});

rl.on('line', (line) => {
  handleCommand(line);
  prompt();
});

rl.on('close', () => {
  if (socket && !socket.destroyed) socket.destroy();
  if (server) server.close();
  if (discoveryServer) discoveryServer.close();
  process.exit(0);
});

console.log('iTantra Laptop Test Node');
console.log('Protocol: JSON messages separated by newline');
console.log('TCP communication port: 5555');
console.log('TCP discovery port: 5556');
console.log('Type "help" for commands.');
prompt();
