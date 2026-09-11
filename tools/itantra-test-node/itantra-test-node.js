#!/usr/bin/env node
'use strict';

const net = require('node:net');
const dgram = require('node:dgram');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');

const PORT = 5555;
const DISCOVERY_PORT = 5556;
const MDNS_PORT = 5353;
const MDNS_ADDRESS = '224.0.0.251';
const SERVICE_TYPE = '_itantra._tcp.local';
const DEFAULT_NAME = 'Laptop Test Node';
const DEVICE_ID = 'laptop-test-node';
const HOSTNAME = 'itantra-laptop.local';
const MAGIC = 'ITANTRA_DISCOVER_V1';
const TCP_PROBE = 'ITANTRA_PROBE_V1';

let socket = null;
let server = null;
let discoveryServer = null;
let mdnsSocket = null;
let mdnsTimer = null;
let buffer = '';
let connectedPeer = null;
let localIPv4 = null;

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
  if (message.type === 'heartbeat') return false;

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
  return true;
}

function handleData(data) {
  buffer += data.toString('utf8');
  let index;
  let shouldPrompt = false;

  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;

    try {
      if (handleMessage(JSON.parse(line))) shouldPrompt = true;
    } catch (error) {
      console.log(`\n[RECV RAW] ${line}\n[WARN] Invalid JSON: ${error.message}`);
      shouldPrompt = true;
    }
  }

  if (shouldPrompt) prompt();
}

function attachSocket(newSocket) {
  const previousSocket = socket;
  socket = newSocket;
  buffer = '';
  connectedPeer = `${newSocket.remoteAddress}:${newSocket.remotePort}`;
  newSocket.setTimeout(0);
  newSocket.setEncoding('utf8');

  console.log(`\nConnected to ${connectedPeer}`);

  let firstChunk = true;
  let probeBuffer = '';
  const onData = data => {
    if (firstChunk) {
      probeBuffer += data;
      const newline = probeBuffer.indexOf('\n');
      if (newline !== -1) {
        const firstLine = probeBuffer.slice(0, newline).trim();
        if (firstLine === TCP_PROBE) {
          const response = { magic: TCP_PROBE, id: DEVICE_ID, name: DEFAULT_NAME, port: PORT };
          newSocket.write(JSON.stringify(response) + '\n', 'utf8', () => newSocket.destroy());
          if (socket === newSocket) {
            socket = previousSocket && !previousSocket.destroyed ? previousSocket : null;
            connectedPeer = socket ? `${socket.remoteAddress}:${socket.remotePort}` : null;
          }
          return;
        }
        firstChunk = false;
        probeBuffer = '';
      } else {
        return;
      }
    }
    if (socket === newSocket) handleData(data);
  };

  newSocket.on('data', onData);
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
    client.setEncoding('utf8');
    client.on('data', data => {
      requestBuffer += data;
      if (!requestBuffer.includes('\n')) return;
      const request = requestBuffer.split('\n')[0].trim();
      if (request !== MAGIC) { client.destroy(); return; }
      const response = { magic: MAGIC, id: DEVICE_ID, name: DEFAULT_NAME, port: PORT };
      client.write(JSON.stringify(response) + '\n', 'utf8', () => client.destroy());
      console.log(`[FALLBACK] Discovery request from ${remote}`);
    });
  });
  discoveryServer.on('error', error => {
    console.error(`\nDiscovery server error: ${error.message}`);
    if (error.code === 'EADDRINUSE') console.error(`Port ${DISCOVERY_PORT} is already in use.`);
  });
  discoveryServer.listen(DISCOVERY_PORT, '0.0.0.0', () => {
    console.log(`\nTCP fallback discovery listening on 0.0.0.0:${DISCOVERY_PORT}`);
    prompt();
  });
}

function encodeName(name) {
  const labels = name.split('.');
  const parts = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, 'utf8');
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value & 0xffff, 0);
  return b;
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0, 0);
  return b;
}

function txtRecord(key, value) {
  const text = Buffer.from(`${key}=${value}`, 'utf8');
  return Buffer.concat([Buffer.from([text.length]), text]);
}

function buildMdnsResponse() {
  if (!localIPv4) return null;

  const serviceName = `${DEFAULT_NAME}.${SERVICE_TYPE}`;
  const serviceNameBytes = encodeName(serviceName);
  const serviceTypeBytes = encodeName(SERVICE_TYPE);
  const hostnameBytes = encodeName(HOSTNAME);
  const records = [];

  // PTR: _itantra._tcp.local -> Laptop Test Node._itantra._tcp.local
  records.push(Buffer.concat([
    serviceTypeBytes,
    u16(12), u16(1), u32(120),
    u16(serviceNameBytes.length), serviceNameBytes,
  ]));

  // SRV: service instance -> hostname + TCP port
  const srvData = Buffer.concat([u16(0), u16(0), u16(PORT), hostnameBytes]);
  records.push(Buffer.concat([
    serviceNameBytes,
    u16(33), u16(1), u32(120), u16(srvData.length), srvData,
  ]));

  // TXT metadata. The phone can resolve the service even without reading this.
  const txtData = Buffer.concat([
    txtRecord('id', DEVICE_ID),
    txtRecord('name', DEFAULT_NAME),
    txtRecord('port', String(PORT)),
  ]);
  records.push(Buffer.concat([
    serviceNameBytes,
    u16(16), u16(1), u32(120), u16(txtData.length), txtData,
  ]));

  // A: hostname -> laptop IPv4
  const address = Buffer.from(localIPv4.split('.').map(Number));
  records.push(Buffer.concat([
    hostnameBytes,
    u16(1), u16(1), u32(120), u16(4), address,
  ]));

  const header = Buffer.concat([
    u16(0), u16(0x8400), u16(0), u16(records.length), u16(0), u16(0),
  ]);

  return Buffer.concat([header, ...records]);
}

function startMdns() {
  if (mdnsSocket) return;

  localIPv4 = getLocalIPv4();
  if (!localIPv4) {
    console.log('\nNo local IPv4 address available; mDNS advertisement not started.');
    return;
  }

  mdnsSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  mdnsSocket.on('error', error => console.error(`\nmDNS error: ${error.message}`));
  mdnsSocket.bind(MDNS_PORT, '0.0.0.0', () => {
    try {
      mdnsSocket.addMembership(MDNS_ADDRESS);
      mdnsSocket.setMulticastTTL(255);
      mdnsSocket.setMulticastLoopback(true);
    } catch (error) {
      console.error(`\nmDNS multicast setup error: ${error.message}`);
    }

    advertiseMdns();
    mdnsTimer = setInterval(advertiseMdns, 5000);
    console.log(`mDNS advertisement active: ${SERVICE_TYPE} -> ${localIPv4}:${PORT}`);
    prompt();
  });
}

function advertiseMdns() {
  if (!mdnsSocket) return;
  const packet = buildMdnsResponse();
  if (!packet) return;
  mdnsSocket.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDRESS, error => {
    if (error) console.error(`\nmDNS send error: ${error.message}`);
  });
}

function stopMdns() {
  if (mdnsTimer) clearInterval(mdnsTimer);
  mdnsTimer = null;
  if (mdnsSocket) mdnsSocket.close();
  mdnsSocket = null;
}

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  const preferred = [];
  const fallback = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const item = { name, address: entry.address };
      if (/wi-?fi|wlan|wireless/i.test(name)) preferred.push(item);
      else if (!/virtual|vmware|vbox|bluetooth|tether|loopback/i.test(name)) fallback.push(item);
    }
  }
  return (preferred[0] || fallback[0])?.address || null;
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
  console.log(`mDNS: ${mdnsSocket ? `advertising ${SERVICE_TYPE}` : 'stopped'}`);
  console.log(`TCP fallback discovery: ${discoveryServer ? 'running on :5556' : 'stopped'}`);
  console.log(`Connection: ${socket && !socket.destroyed ? 'connected' : 'not connected'}`);
  if (connectedPeer) console.log(`Peer: ${connectedPeer}`);
}

function help() {
  console.log(`
Commands
--------
start                 Start laptop TCP server on port 5555
discovery             Start TCP + mDNS + TCP fallback discovery
c <phone-ip>          Connect directly to a phone on TCP port 5555
r                     Send call_request
accept                Send call_accept
reject                Send call_reject
s <text>              Send speech_message
end                   Send call_end
hb                    Send heartbeat
status                Show server, mDNS and connection status
stop-discovery        Stop mDNS + TCP fallback discovery
help                  Show this help
quit                  Exit
`);
}

function stopDiscovery() {
  stopMdns();
  if (discoveryServer) {
    discoveryServer.close(() => console.log('TCP fallback discovery stopped.'));
    discoveryServer = null;
  }
}

function connectToPhone(host) {
  if (!host) { console.log('Usage: c <phone-ip>'); return; }
  if (socket && !socket.destroyed) socket.destroy();
  const client = net.createConnection({ host, port: PORT, timeout: 10000 }, () => {
    client.setTimeout(0);
    attachSocket(client);
    console.log(`Connected to phone at ${host}:${PORT}`);
    prompt();
  });
  client.on('timeout', () => { console.log('\nConnection timed out while establishing TCP connection.'); client.destroy(); });
  client.on('error', error => { console.log(`\nCould not connect to ${host}:${PORT}: ${error.message}`); prompt(); });
}

function handleCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const [command, ...rest] = trimmed.split(/\s+/);
  const argument = rest.join(' ').trim();
  switch (command.toLowerCase()) {
    case 'start': startServer(); break;
    case 'discovery': startServer(); startDiscoveryServer(); startMdns(); break;
    case 'devices': console.log('Device discovery is handled by Android NSD on the phone.'); break;
    case 'stop-discovery': stopDiscovery(); break;
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
  stopDiscovery();
  rl.close();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'itantra> ' });
rl.on('line', line => { handleCommand(line); });
rl.on('close', () => {
  if (socket && !socket.destroyed) socket.destroy();
  if (server) server.close();
  stopDiscovery();
  process.exit(0);
});

console.log('iTantra Laptop Test Node');
console.log(`TCP communication port: ${PORT}`);
console.log(`mDNS service: ${SERVICE_TYPE}`);
console.log(`TCP fallback discovery port: ${DISCOVERY_PORT}`);
console.log('Type "help" for commands.');
prompt();
