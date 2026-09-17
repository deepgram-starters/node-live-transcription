const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { WebSocket } = require('ws');

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForSession(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited before accepting connections (${child.exitCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/session`);
      if (response.ok) return response.json();
    } catch {
      // The child process has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Backend did not start within 10 seconds');
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

test('sends a sanitized Error frame before a non-normal close when Deepgram rejects authentication', { timeout: 15_000 }, async (t) => {
  const upstream = http.createServer();
  upstream.on('upgrade', (_request, socket) => {
    // Reject before opening the socket, as Deepgram does for invalid credentials.
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamPort = upstream.address().port;
  t.after(() => new Promise((resolve) => upstream.close(resolve)));

  const appPort = await getFreePort();
  const apiKey = 'test-key-that-must-not-reach-the-browser';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEEPGRAM_API_KEY: apiKey,
      DEEPGRAM_BASE_URL: `ws://127.0.0.1:${upstreamPort}`,
      HOST: '127.0.0.1',
      PORT: String(appPort),
      SESSION_SECRET: 'test-session-secret',
    },
    stdio: 'ignore',
  });
  t.after(() => stopChild(child));

  const { token } = await waitForSession(appPort, child);
  const browser = new WebSocket(
    `ws://127.0.0.1:${appPort}/api/live-transcription`,
    `access_token.${token}`,
  );
  const events = [];

  await new Promise((resolve, reject) => {
    browser.once('error', reject);
    browser.on('message', (data) => events.push({ type: 'message', data: data.toString() }));
    browser.on('close', (code, reason) => {
      events.push({ type: 'close', code, reason: reason.toString() });
      resolve();
    });
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'message');
  assert.deepEqual(JSON.parse(events[0].data), {
    type: 'Error',
    description: 'Unable to connect to transcription service. Check your API key and try again.',
  });
  assert.doesNotMatch(events[0].data, new RegExp(apiKey));
  assert.deepEqual(events[1], {
    type: 'close',
    code: 1011,
    reason: 'Transcription service connection failed',
  });
});
