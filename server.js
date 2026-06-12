/**
 * Node Live Transcription Starter - Backend Server
 *
 * Simple WebSocket proxy to Deepgram's Live Transcription API.
 * Forwards all messages (JSON and binary) bidirectionally between client and Deepgram.
 *
 * Routes:
 *   GET  /api/session              - Issue JWT session token
 *   GET  /api/metadata             - Project metadata from deepgram.toml
 *   WS   /api/live-transcription   - WebSocket proxy to Deepgram STT (auth required)
 */

const { WebSocketServer, WebSocket } = require('ws');
const express = require('express');
const { createServer } = require('http');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const toml = require('toml');
const { getTtsProvider } = require('./tts');

// Validate required environment variables
if (!process.env.DEEPGRAM_API_KEY) {
  console.error('ERROR: DEEPGRAM_API_KEY environment variable is required');
  console.error('Please copy sample.env to .env and add your API key');
  process.exit(1);
}

// Configuration
const CONFIG = {
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  deepgramSttUrl: 'wss://api.deepgram.com/v1/listen',
  port: process.env.PORT || 8081,
  host: process.env.HOST || '0.0.0.0',

  // Text-to-Speech (additive; STT works without these)
  ttsProvider: process.env.TTS_PROVIDER || 'sixtydb',
  sixtydbApiKey: process.env.SIXTYDB_API_KEY,
  sixtydbTtsWsUrl: process.env.SIXTYDB_TTS_WS_URL || 'wss://api.60db.ai/ws/tts',
  sixtydbDefaultVoice: process.env.SIXTYDB_DEFAULT_VOICE || '',
};

if (!CONFIG.sixtydbApiKey) {
  console.warn(
    'WARNING: SIXTYDB_API_KEY not set — WS /api/tts will reject connections until configured'
  );
}

// ============================================================================
// SESSION AUTH - JWT tokens for production security
// ============================================================================

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const JWT_EXPIRY = '1h';

/**
 * Validates JWT from WebSocket subprotocol: access_token.<jwt>
 * Returns the token string if valid, null if invalid.
 */
function validateWsToken(protocols) {
  if (!protocols) return null;
  const list = Array.isArray(protocols) ? protocols : protocols.split(',').map(s => s.trim());
  const tokenProto = list.find(p => p.startsWith('access_token.'));
  if (!tokenProto) return null;
  const token = tokenProto.slice('access_token.'.length);
  try {
    jwt.verify(token, SESSION_SECRET);
    return tokenProto;
  } catch {
    return null;
  }
}

const app = express();
const server = createServer(app);

// Accept the access_token.* subprotocol so the client sees it echoed back.
// Shared by every authenticated WebSocket endpoint (STT and TTS).
function acceptAccessTokenProtocol(protocols) {
  for (const proto of protocols) {
    if (proto.startsWith('access_token.')) return proto;
  }
  return false;
}

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: acceptAccessTokenProtocol,
});

// Separate WS server for TTS so its connection handling stays isolated from STT.
const ttsWss = new WebSocketServer({
  noServer: true,
  handleProtocols: acceptAccessTokenProtocol,
});

// Track all active WebSocket connections for graceful shutdown
const activeConnections = new Set();

// Enable CORS
app.use(cors());

// ============================================================================
// SESSION ROUTES - Auth endpoints (unprotected)
// ============================================================================

/**
 * GET /api/session — Issues a signed JWT for session authentication.
 */
app.get('/api/session', (req, res) => {
  const token = jwt.sign(
    { iat: Math.floor(Date.now() / 1000) },
    SESSION_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
  res.json({ token });
});

/**
 * Metadata endpoint - required for standardization compliance
 */
app.get('/api/metadata', (req, res) => {
  try {
    const tomlPath = path.join(__dirname, 'deepgram.toml');
    const tomlContent = fs.readFileSync(tomlPath, 'utf-8');
    const config = toml.parse(tomlContent);

    if (!config.meta) {
      return res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Missing [meta] section in deepgram.toml'
      });
    }

    res.json(config.meta);
  } catch (error) {
    console.error('Error reading metadata:', error);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to read metadata from deepgram.toml'
    });
  }
});

/**
 * WebSocket proxy handler
 * Forwards all messages bidirectionally between client and Deepgram
 */
wss.on('connection', async (clientWs, request) => {
  console.log('Client connected to /api/live-transcription');
  activeConnections.add(clientWs);

  // Parse query parameters from client request
  const url = new URL(request.url, `http://${request.headers.host}`);
  const model = url.searchParams.get('model') || 'nova-3';
  const language = url.searchParams.get('language') || 'en';
  const smart_format = url.searchParams.get('smart_format') || 'true';
  const encoding = url.searchParams.get('encoding') || 'linear16';
  const sample_rate = url.searchParams.get('sample_rate') || '16000';
  const channels = url.searchParams.get('channels') || '1';

  // Build Deepgram WebSocket URL with query parameters
  const deepgramUrl = new URL(CONFIG.deepgramSttUrl);
  deepgramUrl.searchParams.set('model', model);
  deepgramUrl.searchParams.set('language', language);
  deepgramUrl.searchParams.set('smart_format', smart_format);
  deepgramUrl.searchParams.set('encoding', encoding);
  deepgramUrl.searchParams.set('sample_rate', sample_rate);
  deepgramUrl.searchParams.set('channels', channels);

  console.log(`Connecting to Deepgram STT: model=${model}, language=${language}, encoding=${encoding}, sample_rate=${sample_rate}, channels=${channels}`);

  // Create WebSocket connection to Deepgram
  const deepgramWs = new WebSocket(deepgramUrl.toString(), {
    headers: {
      'Authorization': `Token ${CONFIG.deepgramApiKey}`
    }
  });

  let clientMessageCount = 0;
  let deepgramMessageCount = 0;

  // Forward Deepgram messages to client
  deepgramWs.on('message', (data, isBinary) => {
    deepgramMessageCount++;
    if (deepgramMessageCount % 10 === 0 || !isBinary) {
      console.log(`← Deepgram message #${deepgramMessageCount} (binary: ${isBinary}, size: ${data.length})`);
    }
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  // Forward client messages to Deepgram
  clientWs.on('message', (data, isBinary) => {
    clientMessageCount++;
    if (clientMessageCount % 100 === 0 || !isBinary) {
      console.log(`→ Client message #${clientMessageCount} (binary: ${isBinary}, size: ${data.byteLength || data.length})`);
    }
    if (deepgramWs.readyState === WebSocket.OPEN) {
      deepgramWs.send(data, { binary: isBinary });
    }
  });

  // Handle Deepgram connection open
  deepgramWs.on('open', () => {
    console.log('✓ Connected to Deepgram STT API');
  });

  // Handle Deepgram errors
  deepgramWs.on('error', (error) => {
    console.error('Deepgram WebSocket error:', error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Deepgram connection error');
    }
  });

  // Handle Deepgram connection close
  deepgramWs.on('close', (code, reason) => {
    console.log(`Deepgram connection closed: ${code} ${reason}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason.toString());
    }
  });

  // Handle client disconnect
  clientWs.on('close', (code, reason) => {
    console.log(`Client disconnected: ${code} ${reason}`);
    if (deepgramWs.readyState === WebSocket.OPEN) {
      deepgramWs.close(1000, 'Client disconnected');
    }
    activeConnections.delete(clientWs);
  });

  // Handle client errors
  clientWs.on('error', (error) => {
    console.error('Client WebSocket error:', error);
    if (deepgramWs.readyState === WebSocket.OPEN) {
      deepgramWs.close(1011, 'Client error');
    }
  });
});

// ============================================================================
// TTS PROXY - WS /api/tts (provider-agnostic, see tts/provider.js)
// ============================================================================

/** Send JSON to the client only if the socket is still open. */
function safeSendJson(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

/** Parse an optional numeric query param; undefined when absent/invalid. */
function numOrUndefined(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * TTS WebSocket proxy handler.
 *
 * Bridges a provider-agnostic browser protocol to the selected TTS provider:
 *   Client → server (JSON): { type: 'speak', text }, { type: 'flush' }, { type: 'close' }
 *   Server → client:        binary audio frames, plus JSON status messages
 *                           ({ type: 'ready' | 'flush_completed' | 'connected'
 *                              | 'context_closed' | 'error' })
 */
ttsWss.on('connection', (clientWs, request) => {
  console.log('Client connected to /api/tts');
  activeConnections.add(clientWs);

  const url = new URL(request.url, `http://${request.headers.host}`);
  const providerName = url.searchParams.get('provider') || CONFIG.ttsProvider;

  let provider;
  try {
    provider = getTtsProvider(providerName);
  } catch (err) {
    safeSendJson(clientWs, { type: 'error', message: err.message });
    clientWs.close(1008, 'Unknown TTS provider');
    activeConnections.delete(clientWs);
    return;
  }

  if (providerName === 'sixtydb' && !CONFIG.sixtydbApiKey) {
    safeSendJson(clientWs, {
      type: 'error',
      message: 'TTS not configured: SIXTYDB_API_KEY is missing',
    });
    clientWs.close(1011, 'TTS not configured');
    activeConnections.delete(clientWs);
    return;
  }

  const session = provider.createSession({
    apiKey: CONFIG.sixtydbApiKey,
    wsUrl: CONFIG.sixtydbTtsWsUrl,
    voiceId: url.searchParams.get('voice') || CONFIG.sixtydbDefaultVoice || undefined,
    audioEncoding: url.searchParams.get('encoding') || undefined,
    sampleRate: numOrUndefined(url.searchParams.get('sample_rate')),
    speed: numOrUndefined(url.searchParams.get('speed')),
    stability: numOrUndefined(url.searchParams.get('stability')),
    similarity: numOrUndefined(url.searchParams.get('similarity')),
  });

  console.log(`Connecting to TTS provider: ${providerName}`);

  // Upstream session events → client
  session.on('connected', (info) => safeSendJson(clientWs, { type: 'connected', ...info }));
  session.on('ready', (info) => safeSendJson(clientWs, { type: 'ready', ...info }));
  session.on('audio', (buf) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(buf, { binary: true });
  });
  session.on('flushCompleted', (info) =>
    safeSendJson(clientWs, { type: 'flush_completed', ...info })
  );
  session.on('contextClosed', (info) =>
    safeSendJson(clientWs, { type: 'context_closed', ...info })
  );
  session.on('providerError', (err) =>
    safeSendJson(clientWs, { type: 'error', message: err.message })
  );
  session.on('error', (err) => {
    console.error('TTS upstream error:', err.message);
    safeSendJson(clientWs, { type: 'error', message: 'TTS upstream error' });
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011, 'TTS upstream error');
  });
  session.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, 'TTS session closed');
  });

  // Client control messages → upstream session
  clientWs.on('message', (data, isBinary) => {
    if (isBinary) return; // TTS is text-driven; ignore stray binary frames
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      safeSendJson(clientWs, { type: 'error', message: 'Invalid JSON message' });
      return;
    }
    switch (msg.type) {
      case 'speak':
        session.speak(msg.text || '');
        break;
      case 'flush':
        session.flush();
        break;
      case 'close':
        session.close();
        break;
      default:
        safeSendJson(clientWs, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  clientWs.on('close', (code, reason) => {
    console.log(`TTS client disconnected: ${code} ${reason}`);
    session.close();
    activeConnections.delete(clientWs);
  });

  clientWs.on('error', (error) => {
    console.error('TTS client WebSocket error:', error);
    session.close();
  });

  session.start();
});

/**
 * Handle WebSocket upgrade requests for /api/live-transcription.
 * Validates JWT from access_token.<jwt> subprotocol before upgrading.
 */
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;

  console.log(`WebSocket upgrade request for: ${pathname}`);

  if (pathname === '/api/live-transcription') {
    // Validate JWT from subprotocol
    const protocols = request.headers['sec-websocket-protocol'];
    const validProto = validateWsToken(protocols);
    if (!validProto) {
      console.log('WebSocket auth failed: invalid or missing token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log('Backend handling /api/live-transcription WebSocket (authenticated)');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
    return;
  }

  if (pathname === '/api/tts') {
    // Validate JWT from subprotocol (same scheme as STT)
    const protocols = request.headers['sec-websocket-protocol'];
    const validProto = validateWsToken(protocols);
    if (!validProto) {
      console.log('TTS WebSocket auth failed: invalid or missing token');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    console.log('Backend handling /api/tts WebSocket (authenticated)');
    ttsWss.handleUpgrade(request, socket, head, (ws) => {
      ttsWss.emit('connection', ws, request);
    });
    return;
  }

  // Unknown WebSocket path - reject
  console.log(`Unknown WebSocket path: ${pathname}`);
  socket.destroy();
});

/**
 * Graceful shutdown handler
 */
function gracefulShutdown(signal) {
  console.log(`\n${signal} signal received: starting graceful shutdown...`);

  // Stop accepting new connections
  wss.close(() => {
    console.log('STT WebSocket server closed to new connections');
  });
  ttsWss.close(() => {
    console.log('TTS WebSocket server closed to new connections');
  });

  // Close all active WebSocket connections
  console.log(`Closing ${activeConnections.size} active WebSocket connection(s)...`);
  activeConnections.forEach((ws) => {
    try {
      ws.close(1001, 'Server shutting down');
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    }
  });

  // Close the HTTP server
  server.close(() => {
    console.log('HTTP server closed');
    console.log('Shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start server
server.listen(CONFIG.port, CONFIG.host, () => {
  console.log("\n" + "=".repeat(70));
  console.log(`🚀 Backend API Server running at http://localhost:${CONFIG.port}`);
  console.log("");
  console.log(`📡 GET  /api/session`);
  console.log(`📡 WS   /api/live-transcription (auth required)`);
  console.log(`📡 WS   /api/tts (auth required, provider=${CONFIG.ttsProvider})`);
  console.log(`📡 GET  /api/metadata`);
  console.log("=".repeat(70) + "\n");
});
