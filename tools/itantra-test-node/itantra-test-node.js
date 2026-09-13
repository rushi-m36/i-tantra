#!/usr/bin/env node
'use strict';

const net = require('node:net');
const dgram = require('node:dgram');
const os = require('node:os');
const readline = require('node:readline');
const crypto = require('node:crypto');

const PORT = 5555;
const MDNS_PORT = 5353;
const MDNS_ADDRESS = '224.0.0.251';
const SERVICE_TYPE = '_itantra._tcp.local';
const DEFAULT_NAME = 'Laptop Test Node';
const DEVICE_ID = 'laptop-test-node';
const HOSTNAME = 'itantra-laptop.local';

let socket = null;
let server = null;
let mdnsSocket = null;
let mdnsTimer = null;
let buffer = '';
let connectedPeer = null;
let localIPv4 = null;

function now() { return Date.now(); }

function send(message) {
  if (!socket || socket.destroyed) {
    console.log('\nNot connected. Use "connect <phone-ip>" first.');
    return;
  }
  socket.write(JSON.stringify(message) + '\n', 'utf8');
  console.log(`\n[SEND] ${JSON.stringify(message)}`);
}

function handleMessage(message) {
  if (message.type === 'heartbeat') return false;
  console.log(`\n[RECV] ${JSON.stringify(message, null, 2)}`);
  switch (message.type) {
    case 'call_request': console.log(`\n>>> INCOMING CALL from ${message.senderName || message.senderId || 'iTantra device'}`); break;
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
  if (socket && socket !== newSocket && !socket.destroyed) socket.destroy();
  socket = newSocket;
  buffer = '';
  connectedPeer = `${newSocket.remoteAddress}:${newSocket.remotePort}`;
  newSocket.setTimeout(0);
  newSocket.setEncoding('utf8');
  console.log(`\nConnected to ${connectedPeer}`);
  newSocket.on('data', handleData);
  newSocket.on('error', error => console.log(`\nSocket error: ${error.message}`));
  newSocket.on('close', () => {
    if (socket === newSocket) { socket = null; connectedPeer = null; buffer = ''; }
    console.log('\nConnection closed.');
    prompt();
  });
}

function startServer() {
  if (server) { console.log(`TCP server already running on :${PORT}.`); return; }
  server = net.createServer(attachSocket);
  server.on('error', error => console.error(`\nTCP server error: ${error.message}`));
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nTCP server listening on :${PORT}`);
    console.log('Waiting for iTantra connections...');
    prompt();
  });
}

function encodeName(name) {
  return Buffer.concat([...name.split('.').map(label => { const bytes = Buffer.from(label, 'utf8'); return Buffer.concat([Buffer.from([bytes.length]), bytes]); }), Buffer.from([0])]);
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16BE(value & 0xffff, 0); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0, 0); return b; }
function txtRecord(key, value) { const text = Buffer.from(`${key}=${value}`, 'utf8'); return Buffer.concat([Buffer.from([text.length]), text]); }

function buildMdnsResponse() {
  if (!localIPv4) return null;
  const serviceName = `${DEFAULT_NAME}.${SERVICE_TYPE}`;
  const serviceNameBytes = encodeName(serviceName);
  const serviceTypeBytes = encodeName(SERVICE_TYPE);
  const hostnameBytes = encodeName(HOSTNAME);
  const records = [];
  records.push(Buffer.concat([serviceTypeBytes, u16(12), u16(1), u32(120), u16(serviceNameBytes.length), serviceNameBytes]));
  const srvData = Buffer.concat([u16(0), u16(0), u16(PORT), hostnameBytes]);
  records.push(Buffer.concat([serviceNameBytes, u16(33), u16(1), u32(120), u16(srvData.length), srvData]));
  const txtData = Buffer.concat([txtRecord('id', DEVICE_ID), txtRecord('name', DEFAULT_NAME), txtRecord('port', String(PORT))]);
  records.push(Buffer.concat([serviceNameBytes, u16(16), u16(1), u32(120), u16(txtData.length), txtData]));
  records.push(Buffer.concat([hostnameBytes, u16(1), u16(1), u32(120), u16(4), Buffer.from(localIPv4.split('.').map(Number))]));
  const header = Buffer.concat([u16(0), u16(0x8400), u16(0), u16(records.length), u16(0), u16(0)]);
  return Buffer.concat([header, ...records]);
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

function startMdns() {
  if (mdnsSocket) { console.log(`mDNS already running for ${SERVICE_TYPE}.`); return; }
  localIPv4 = getLocalIPv4();
  if (!localIPv4) { console.log('\nNo local IPv4 address found.'); return; }
  mdnsSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  mdnsSocket.on('error', error => console.error(`\nmDNS error: ${error.message}`));
  mdnsSocket.bind(MDNS_PORT, '0.0.0.0', () => {
    try { mdnsSocket.addMembership(MDNS_ADDRESS); mdnsSocket.setMulticastTTL(255); mdnsSocket.setMulticastLoopback(true); } catch (error) { console.error(`\nmDNS setup error: ${error.message}`); }
    advertiseMdns();
    mdnsTimer = setInterval(advertiseMdns, 5000);
    console.log(`mDNS advertising ${SERVICE_TYPE} -> ${localIPv4}:${PORT}`);
    prompt();
  });
}

function advertiseMdns() {
  if (!mdnsSocket) return;
  const packet = buildMdnsResponse();
  if (!packet) return;
  mdnsSocket.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDRESS, error => { if (error) console.error(`\nmDNS send error: ${error.message}`); });
}

function stopMdns() {
  if (mdnsTimer) clearInterval(mdnsTimer);
  mdnsTimer = null;
  if (mdnsSocket) mdnsSocket.close();
  mdnsSocket = null;
  console.log('mDNS stopped.');
}

function connectToPhone(host) {
  if (!host) { console.log('Usage: connect <phone-ip>'); return; }
  if (socket && !socket.destroyed) socket.destroy();
  const client = net.createConnection({ host, port: PORT, timeout: 10000 }, () => { client.setTimeout(0); attachSocket(client); });
  client.on('timeout', () => { console.log('\nConnection timed out.'); client.destroy(); });
  client.on('error', error => { console.log(`\nCould not connect to ${host}:${PORT}: ${error.message}`); prompt(); });
}

function callRequest() { send({ type: 'call_request', senderId: DEVICE_ID, senderName: DEFAULT_NAME, timestamp: now() }); }
function callAccept() { send({ type: 'call_accept', senderId: DEVICE_ID, timestamp: now() }); }
function callReject() { send({ type: 'call_reject', senderId: DEVICE_ID, timestamp: now() }); }
function speech(text) { if (!text) { console.log('Usage: message <text>'); return; } send({ type: 'speech_message', id: crypto.randomUUID(), senderId: DEVICE_ID, text, timestamp: now() }); }
function callEnd() { send({ type: 'call_end', senderId: DEVICE_ID, timestamp: now() }); }
function heartbeat() { send({ type: 'heartbeat', senderId: DEVICE_ID, timestamp: now() }); }

function status() {
  console.log('\nStatus');
  console.log(`  TCP server       ${server ? 'running :5555' : 'stopped'}`);
  console.log(`  mDNS             ${mdnsSocket ? 'advertising' : 'stopped'}`);
  console.log(`  Connection       ${socket && !socket.destroyed ? 'connected' : 'not connected'}`);
  if (connectedPeer) console.log(`  Peer             ${connectedPeer}`);
}

function help() {
  console.log(`
Commands
--------
start                     Start the TCP server on port 5555
nsd                       Start mDNS advertisement for NSD testing
connect <phone-ip>        Connect directly to a phone on port 5555
call                      Send an incoming-call request
accept                    Accept a call
reject                    Reject a call
message <text>            Send a text/speech message
end                       End the call
heartbeat                 Send a heartbeat
status                    Show test-node status
stop-nsd                  Stop mDNS advertisement
help                      Show this help
quit                      Exit

Typical NSD test
----------------
1. Run: start
2. Run: nsd
3. Open iTantra on the phone
4. Verify "Laptop Test Node" appears
5. Put iTantra in the background
6. Test discovery/call behavior from the laptop
`);
}

function handleCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  const [command, ...rest] = trimmed.split(/\s+/);
  const argument = rest.join(' ').trim();
  switch (command.toLowerCase()) {
    case 'start': startServer(); break;
    case 'nsd': startMdns(); break;
    case 'connect': case 'c': connectToPhone(argument); break;
    case 'call': case 'request': callRequest(); break;
    case 'accept': callAccept(); break;
    case 'reject': callReject(); break;
    case 'message': case 'msg': case 's': speech(argument); break;
    case 'end': callEnd(); break;
    case 'heartbeat': case 'hb': heartbeat(); break;
    case 'status': status(); break;
    case 'stop-nsd': stopMdns(); break;
    case 'help': case '?': help(); break;
    case 'quit': case 'exit': shutdown(); break;
    default: console.log(`Unknown command: ${command}. Type help.`);
  }
}

function prompt() { rl.prompt(); }
function shutdown() { if (socket && !socket.destroyed) socket.destroy(); if (server) server.close(); stopMdns(); rl.close(); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'itantra> ' });
rl.on('line', handleCommand);
rl.on('close', () => { if (socket && !socket.destroyed) socket.destroy(); if (server) server.close(); stopMdns(); process.exit(0); });

console.log('iTantra Laptop Test Node v1.0');
console.log('Run "help" for commands.');
prompt();
