#!/usr/bin/env node
'use strict';

const net = require('node:net');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');

const PORT = 5555;
const DISCOVERY_PORT = 5556;
const DEFAULT_NAME = 'Laptop Test Node';
const DEVICE_ID = 'laptop-test-node';
const MAGIC = 'ITANTRA_DISCOVER_V1';

let socket = null;
let server = null;
let discoveryServer = null;
let scanInProgress = false;
let buffer = '';
let connectedPeer = null;
let discoveredDevices = new Map();

function now() { return Date.now(); }

function send(message) {
  if (!socket || socket.destroyed) {
    console.log('\nNot connected. Use c <phone-ip> first.');
    return;
  }
  socket.write(JSON.stringify(message) + '\n', 'utf8');
  console.log(`\n[SEND] ${JSON.stringify(message)}`);
}

function handleMessage(message) {
  console.log(`\n[RECV] ${JSON.stringify(message, null, 2)}`);
  switch (message.type) {
    case 'call_request':
      console.log(`\n>>> INCOMING CALL REQUEST from ${message.senderName || message.senderId || 'iTantra device'}`);
      console.log('>>> Type: accept or reject');
      break;
    case 'call_accept': console.log('\n>>> CALL ACCEPTED'); break;
    case 'call_reject': console.log('\n>>> CALL REJECTED'); break;
    case 'speech_message': console.log(`\n>>> MESSAGE: ${message.text || ''}`); break;
    case 'call_end': console.log('\n>>> CALL ENDED'); break;
  }
}

function handleData(data) {
  buffer += data.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try { handleMessage(JSON.parse(line)); }
    catch (error) { console.log(`\n[RECV RAW] ${line}\n[WARN] Invalid JSON: ${error.message}`); }
  }
  prompt();
}

function attachSocket(newSocket) {
  if (socket && socket !== newSocket && !socket.destroyed) socket.destroy();
  socket = newSocket;
  buffer = '';
  connectedPeer = `${newSocket.remoteAddress}:${newSocket.remotePort}`;

  // The 10-second timeout is only for establishing a connection.
  // Once connected, keep the TCP session open indefinitely. A TCP connection
  // must not be destroyed just because no message was sent for 10 seconds.
  newSocket.setTimeout(0);

  console.log(`\nConnected to ${connectedPeer}`);
  newSocket.setEncoding('utf8');
  newSocket.on('data', handleData);
  newSocket.on('error', error => console.log(`\nSocket error: ${error.message}`));
  newSocket.on('close', () => {
    if (socket === newSocket) { socket = null; connectedPeer = null; buffer = ''; }
    console.log('\nConnection closed.');
    prompt();
  });
}

function startServer() {
  if (server) { console.log(`TCP server is already listening on ${PORT}.`); return; }
  server = net.createServer(attachSocket);
  server.on('error', error => {
    console.error(`\nServer error: ${error.message}`);
    if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use.`);
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nTCP server listening on 0.0.0.0:${PORT}`);
    console.log('Phone can connect to this laptop on TCP port 5555.');
    prompt();
  });
}

function startDiscoveryServer() {
  if (discoveryServer) { console.log(`Discovery server is already listening on ${DISCOVERY_PORT}.`); return; }
  discoveryServer = net.createServer(client => {
    let requestBuffer = '';
    const remote = `${client.remoteAddress}:${client.remotePort}`;
    console.log(`\n[DISCOVERY] Request from ${remote}`);
    client.setEncoding('utf8');
    client.on('data', data => {
      requestBuffer += data;
      if (!requestBuffer.includes('\n')) return;
      const request = requestBuffer.split('\n')[0].trim();
      if (request !== MAGIC) { client.destroy(); return; }
      const response = { magic: MAGIC, id: DEVICE_ID, name: DEFAULT_NAME, port: PORT };
      client.write(JSON.stringify(response) + '\n', 'utf8', () => client.destroy());
      console.log(`[DISCOVERY] Sent ${DEFAULT_NAME} to ${remote}`);
    });
  });
  discoveryServer.on('error', error => {
    console.error(`\nDiscovery server error: ${error.message}`);
    if (error.code === 'EADDRINUSE') console.error(`Port ${DISCOVERY_PORT} is already in use.`);
  });
  discoveryServer.listen(DISCOVERY_PORT, '0.0.0.0', () => {
    console.log(`\nDiscovery server listening on 0.0.0.0:${DISCOVERY_PORT}`);
    console.log('Phones can discover this laptop.');
    prompt();
  });
}

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push({ name, address: entry.address, netmask: entry.netmask });
    }
  }
  return addresses;
}

function selectScanInterfaces() {
  const addresses = getLocalIPv4();
  const preferred = addresses.filter(x => /wi-?fi|wlan|wireless/i.test(x.name));
  const ethernet = addresses.filter(x => !/loopback|wi-?fi|wlan|wireless|virtual|vmware|vbox|bluetooth|usb|rndis|tether/i.test(x.name));
  const selected = preferred.length ? preferred : ethernet;
  return selected.length ? selected : addresses;
}

function ipToInt(ip) { return ip.split('.').reduce((n, p) => ((n << 8) | Number(p)) >>> 0, 0); }
function intToIp(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }

function getSubnetAddresses(ip, mask) {
  const ipInt = ipToInt(ip), maskInt = ipToInt(mask);
  const network = (ipInt & maskInt) >>> 0;
  const broadcast = (network | (~maskInt >>> 0)) >>> 0;
  const size = broadcast - network - 1;
  if (size <= 0 || size > 1022) return [];
  const result = [];
  for (let i = network + 1; i < broadcast; i++) result.push(intToIp(i >>> 0));
  return result;
}

function probeDevice(ip) {
  return new Promise(resolve => {
    const client = net.createConnection({ host: ip, port: DISCOVERY_PORT, timeout: 700 }, () => client.write(MAGIC + '\n'));
    let data = '';
    client.setEncoding('utf8');
    client.on('data', chunk => {
      data += chunk;
      const line = data.split('\n')[0].trim();
      try {
        const response = JSON.parse(line);
        if (response.magic === MAGIC && response.id && response.id !== DEVICE_ID) {
          discoveredDevices.set(response.id, { ...response, ip, lastSeen: now() });
          console.log(`[DISCOVERY] Found ${response.name || response.id} at ${ip}:${response.port || PORT}`);
        }
      } catch {}
      client.destroy();
    });
    client.on('error', () => resolve(null));
    client.on('timeout', () => client.destroy());
    client.on('close', () => resolve(true));
  });
}

async function scanNetwork() {
  if (scanInProgress) {
    console.log('Discovery scan is already running.');
    return;
  }

  scanInProgress = true;
  try {
    const interfaces = selectScanInterfaces();
    if (!interfaces.length) {
      console.log('\nNo usable local IPv4 interface found.');
      return;
    }

    // Remove stale results before the new scan.
    for (const [id, device] of discoveredDevices) {
      if (now() - device.lastSeen >= 12000) discoveredDevices.delete(id);
    }

    for (const network of interfaces) {
      const targets = getSubnetAddresses(network.address, network.netmask);
      if (!targets.length) continue;
      console.log(`\n[DISCOVERY SCAN] ${network.name}: ${network.address} / ${network.netmask}`);
      console.log(`[DISCOVERY SCAN] Scanning ${targets.length} addresses on port ${DISCOVERY_PORT}...`);
      for (let i = 0; i < targets.length; i += 20) {
        await Promise.all(targets.slice(i, i + 20).map(probeDevice));
      }
    }

    console.log(`\n[DISCOVERY SCAN] Finished. Found ${discoveredDevices.size} iTantra device(s).`);
    listDevices();
  } finally {
    scanInProgress = false;
    prompt();
  }
}

function listDevices() {
  if (!discoveredDevices.size) {
    console.log('No discovered iTantra devices. Run: scan');
    return;
  }
  console.log('\nDiscovered devices:');
  let index = 1;
  for (const device of discoveredDevices.values()) {
    console.log(`  ${index}. ${device.name || device.id} - ${device.ip}:${device.port || PORT}`);
    index++;
  }
}

function getDeviceBySelector(selector) {
  if (!selector) return null;
  if (/^\d+$/.test(selector)) {
    const index = Number(selector);
    return Array.from(discoveredDevices.values())[index - 1] || null;
  }
  for (const device of discoveredDevices.values()) {
    if (device.ip === selector || device.id === selector || device.name === selector) return device;
  }
  return null;
}

function connectToPhone(host) {
  const device = getDeviceBySelector(host);
  const target = device ? device.ip : host;
  if (!target) { console.log('Usage: c <device-number|phone-ip>'); return; }
  if (socket && !socket.destroyed) socket.destroy();
  const client = net.createConnection({ host: target, port: device?.port || PORT, timeout: 10000 }, () => {
    // 10s is the connection-establishment timeout only. Disable the idle
    // timeout after the TCP handshake so calls/messages can remain connected.
    client.setTimeout(0);
    attachSocket(client);
    console.log(`Connected to ${device?.name || 'device'} at ${target}:${device?.port || PORT}`);
    prompt();
  });
  client.on('timeout', () => { console.log('\nConnection timed out while establishing TCP connection.'); client.destroy(); });
  client.on('error', error => { console.log(`\nCould not connect to ${target}:${device?.port || PORT}: ${error.message}`); prompt(); });
}

function callRequest() { send({ type: 'call_request', senderId: DEVICE_ID, senderName: DEFAULT_NAME, timestamp: now() }); }
function callAccept() { send({ type: 'call_accept', senderId: DEVICE_ID, timestamp: now() }); }
function callReject() { send({ type: 'call_reject', senderId: DEVICE_ID, timestamp: now() }); }
function speech(text) {
  if (!text) { console.log('Usage: s <text>'); return; }
  send({ type: 'speech_message', id: crypto.randomUUID(), senderId: DEVICE_ID, text, timestamp: now() });
}
function callEnd() { send({ type: 'call_end', senderId: DEVICE_ID, timestamp: now() }); }
function heartbeat() { send({ type: 'heartbeat', senderId: DEVICE_ID, timestamp: now() }); }

function status() {
  console.log(`\nTCP server: ${server ? 'running on :5555' : 'stopped'}`);
  console.log(`Discovery server: ${discoveryServer ? 'running on :5556' : 'stopped'}`);
  console.log(`Discovery scan: ${scanInProgress ? 'running' : 'idle'}`);
  console.log(`Connection: ${socket && !socket.destroyed ? 'connected' : 'not connected'}`);
  if (connectedPeer) console.log(`Peer: ${connectedPeer}`);
  listDevices();
}

function help() {
  console.log(`
Commands
--------
start                 Start laptop TCP server on port 5555
discovery             Start TCP + discovery servers, then scan once
scan                  Scan the local subnets once for iTantra devices
devices               List devices found by the last scan
c <number|phone-ip>   Connect to a discovered device (e.g. c 1)
r                     Send call_request
accept                Send call_accept
reject                Send call_reject
s <text>              Send speech_message
end                   Send call_end
hb                    Send heartbeat
status                Show servers, connection and devices
stop-discovery        Stop laptop discovery server
help                  Show this help
quit                  Exit

Recommended laptop -> phone test
----------------------------------
1. Phone hotspot ON; laptop connects to phone hotspot.
2. discovery
3. Wait for "Finished" and the device list.
4. c 1                 Connect to the first discovered phone.
5. r                   Send call request to that phone.
6. Accept on phone.
7. s Hello from laptop
8. end

Phone -> laptop test
-------------------
1. Keep this terminal running with discovery.
2. Phone should discover "Laptop Test Node".
3. Tap Call on the phone.
4. This terminal should show INCOMING CALL REQUEST.
5. Type accept or reject.
`);
}

function stopDiscoveryServer() {
  if (!discoveryServer) { console.log('Discovery server is not running.'); return; }
  discoveryServer.close(() => console.log('Discovery server stopped.'));
  discoveryServer = null;
}

function handleCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const [command, ...rest] = trimmed.split(/\s+/);
  const argument = rest.join(' ').trim();
  switch (command.toLowerCase()) {
    case 'start': startServer(); break;
    case 'discovery': startServer(); startDiscoveryServer(); void scanNetwork(); break;
    case 'scan': void scanNetwork(); break;
    case 'devices': case 'list': listDevices(); break;
    case 'stop-discovery': stopDiscoveryServer(); break;
    case 'c': case 'connect': connectToPhone(argument); break;
    case 'r': case 'request': callRequest(); break;
    case 'accept': callAccept(); break;
    case 'reject': callReject(); break;
    case 's': case 'speech': speech(argument); break;
    case 'end': callEnd(); break;
    case 'hb': case 'heartbeat': heartbeat(); break;
    case 'status': status(); break;
    case 'help': case '?': help(); break;
    case 'quit': case 'exit': shutdown(); break;
    default: console.log(`Unknown command: ${command}. Type help.`);
  }
}

function prompt() { rl.prompt(); }
function shutdown() {
  if (socket && !socket.destroyed) socket.destroy();
  if (server) server.close();
  if (discoveryServer) discoveryServer.close();
  rl.close();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'itantra> ' });
rl.on('line', line => { handleCommand(line); });
rl.on('close', () => { if (socket && !socket.destroyed) socket.destroy(); if (server) server.close(); if (discoveryServer) discoveryServer.close(); process.exit(0); });

console.log('iTantra Laptop Test Node');
console.log('TCP communication port: 5555');
console.log('TCP discovery port: 5556');
console.log('Type "help" for commands.');
prompt();
