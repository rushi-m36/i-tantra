#!/usr/bin/env node
'use strict';

const net = require('node:net');
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
let scanTimer = null;
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
    case 'call_accept':
      console.log('\n>>> CALL ACCEPTED');
      break;
    case 'call_reject':
      console.log('\n>>> CALL REJECTED');
      break;
    case 'speech_message':
      console.log(`\n>>> MESSAGE: ${message.text || ''}`);
      break;
    case 'call_end':
      console.log('\n>>> CALL ENDED');
      break;
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
  if (server) { console.log(`Server is already listening on ${PORT}.`); return; }
  server = net.createServer(attachSocket);
  server.on('error', error => console.error(`\nServer error: ${error.message}`));
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
  discoveryServer.on('error', error => console.error(`\nDiscovery server error: ${error.message}`));
  discoveryServer.listen(DISCOVERY_PORT, '0.0.0.0', () => {
    console.log(`\nDiscovery server listening on 0.0.0.0:${DISCOVERY_PORT}`);
    console.log('Phones can discover this laptop.');
    prompt();
  });
}

function getLocalIPv4() {
  const os = require('node:os');
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push({ name, address: entry.address, netmask: entry.netmask });
    }
  }
  return addresses;
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
    const client = net.createConnection({ host: ip, port: DISCOVERY_PORT, timeout: 500 }, () => {
      client.write(MAGIC + '\n');
    });
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
  const addresses = getLocalIPv4();
  if (!addresses.length) { console.log('\nNo local IPv4 network interface found.'); return; }
  const usable = addresses.find(x => !x.name.toLowerCase().includes('loopback')) || addresses[0];
  const targets = getSubnetAddresses(usable.address, usable.netmask);
  if (!targets.length) {
    console.log(`\nCannot scan subnet ${usable.address}/${usable.netmask}; subnet is too large.`);
    return;
  }
  console.log(`\n[DISCOVERY SCAN] ${usable.name}: ${usable.address} / ${usable.netmask}`);
  console.log(`[DISCOVERY SCAN] Scanning ${targets.length} addresses on port ${DISCOVERY_PORT}...`);
  let found = 0;
  for (let i = 0; i < targets.length; i += 20) {
    const batch = targets.slice(i, i + 20);
    await Promise.all(batch.map(ip => probeDevice(ip)));
  }
  for (const device of discoveredDevices.values()) if (now() - device.lastSeen < 12000) found++;
  console.log(`[DISCOVERY SCAN] Finished. Found ${found} iTantra device(s).`);
}

function startDiscoveryScan() {
  if (scanTimer) { console.log('Discovery scanner is already running.'); return; }
  scanNetwork();
  scanTimer = setInterval(scanNetwork, 5000);
  console.log('Discovery scanner started.');
}

function stopDiscoveryScan() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  console.log('Discovery scanner stopped.');
}

function stopDiscoveryServer() {
  if (!discoveryServer) { console.log('Discovery server is not running.'); return; }
  discoveryServer.close(() => console.log('Discovery server stopped.'));
  discoveryServer = null;
}

function connectToPhone(host) {
  if (!host) { console.log('Usage: c <phone-ip>'); return; }
  if (socket && !socket.destroyed) socket.destroy();
  const client = net.createConnection({ host, port: PORT, timeout: 10000 }, () => {
    attachSocket(client);
    console.log(`Connected to phone at ${host}:${PORT}`);
    prompt();
  });
  client.on('timeout', () => { console.log('\nConnection timed out.'); client.destroy(); });
  client.on('error', error => { console.log(`\nCould not connect to ${host}:${PORT}: ${error.message}`); prompt(); });
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
  console.log(`Discovery scanner: ${scanTimer ? 'running' : 'stopped'}`);
  console.log(`Connection: ${socket && !socket.destroyed ? 'connected' : 'not connected'}`);
  if (connectedPeer) console.log(`Peer: ${connectedPeer}`);
  console.log(`Discovered devices: ${discoveredDevices.size}`);
  for (const device of discoveredDevices.values()) console.log(`  - ${device.name || device.id} (${device.ip}:${device.port || PORT})`);
}

function help() {
  console.log(`
Commands
--------
start                 Start laptop TCP server on port 5555
discovery             Start laptop discovery server + scanner
scan                  Scan the local subnet once for iTantra devices
stop-scan             Stop repeated discovery scanning
stop-discovery        Stop laptop discovery server
c <phone-ip>          Connect directly to a phone on TCP 5555
r                     Send call_request
accept                Send call_accept
reject                Send call_reject
s <text>              Send speech_message
end                   Send call_end
hb                    Send heartbeat
status                Show servers, connection and discovered devices
help                  Show this help
quit                  Exit

Recommended two-way test
-------------------------
1. Phone hotspot ON; laptop connects to phone hotspot.
2. discovery
3. Watch for the phone to appear in the scan results.
4. c <phone-ip> if you want a direct TCP connection.
5. r to call the phone.
6. On the phone, Accept.
7. s Hello from laptop
8. end
`);
}

function handleCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const [command, ...rest] = trimmed.split(' ');
  const argument = rest.join(' ').trim();
  switch (command.toLowerCase()) {
    case 'start': startServer(); break;
    case 'discovery': startDiscoveryServer(); startDiscoveryScan(); break;
    case 'scan': scanNetwork(); break;
    case 'stop-scan': stopDiscoveryScan(); break;
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
  stopDiscoveryScan();
  if (socket && !socket.destroyed) socket.destroy();
  if (server) server.close();
  if (discoveryServer) discoveryServer.close();
  rl.close();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'itantra> ' });
rl.on('line', line => { handleCommand(line); prompt(); });
rl.on('close', () => { if (socket && !socket.destroyed) socket.destroy(); if (server) server.close(); if (discoveryServer) discoveryServer.close(); process.exit(0); });

console.log('iTantra Laptop Test Node');
console.log('TCP communication port: 5555');
console.log('TCP discovery port: 5556');
console.log('Type "help" for commands.');
prompt();
