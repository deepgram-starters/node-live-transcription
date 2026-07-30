/**
 * Node Live Transcription Starter - Backend Server
 *
 * Bridges a browser WebSocket to Deepgram's Live Transcription API
 * (v1 listen, `wss://api.deepgram.com/v1/listen`) using the official
 * @deepgram/sdk `client.listen.v1` streaming support.
 *
 * The Deepgram side goes through the SDK, which manages the WebSocket, auth,
 * reconnection, and message (de)serialization. The browser-facing side is
 * unchanged: the frontend streams binary PCM and receives Deepgram's JSON
 * transcript messages exactly as before.
 *
 * Flow:
 *   browser --(binary PCM audio + JSON control)--> backend --(SDK)--> Deepgram
 *   browser <--(JSON: Results / Metadata / ...)--- backend <--(SDK)-- Deepgram
 *
 * Routes:
 *   GET  /api/session              - Issue JWT session token
 *   GET  /api/metadata             - Project metadata from deepgram.toml
 *   WS   /api/live-transcription   - WebSocket bridge to Deepgram STT (auth required)
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
const { DeepgramClient } = require('@deepgram/sdk');

// Validate required environment variables
if (!process.env.DEEPGRAM_API_KEY) {
  console.error('ERROR: DEEPGRAM_API_KEY environment variable is required');
  console.error('Please copy sample.env to .env and add your API key');
  process.exit(1);
}

// Configuration
const CONFIG = {
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  port: process.env.PORT || 8081,
  host: process.env.HOST || '0.0.0.0',
};

// A single SDK client is reused across connections; auth is resolved from the
// API key here, so the browser never sees it.
//
// DEEPGRAM_BASE_URL (e.g. a staging host like wss://api.staging.deepgram.com)
// overrides the default production endpoint. The listen websocket uses
// `environment.production`, so we set that plus the REST `base`.
const baseUrl = process.env.DEEPGRAM_BASE_URL;
const deepgram = new DeepgramClient({
  apiKey: CONFIG.deepgramApiKey,
  ...(baseUrl
    ? {
        environment: {
          base: baseUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://'),
          production: baseUrl,
          agent: baseUrl,
        },
      }
    : {}),
});
if (baseUrl) {
  console.log(`Using custom Deepgram base URL: ${baseUrl}`);
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
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => {
    // Accept the access_token.* subprotocol so the client sees it echoed back
    for (const proto of protocols) {
      if (proto.startsWith('access_token.')) return proto;
    }
    return false;
  },
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
 * WebSocket bridge handler — one Deepgram STT connection per browser client.
 * Binary audio frames are forwarded to Deepgram via the SDK; Deepgram's JSON
 * transcript messages are forwarded back to the browser unchanged.
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

  console.log(`Connecting to Deepgram STT: model=${model}, language=${language}, encoding=${encoding}, sample_rate=${sample_rate}, channels=${channels}`);

  // Buffer any browser messages that arrive before the Deepgram socket is open.
  let dgReady = false;
  const pending = [];

  // Create the Deepgram STT connection object (not yet connected). The SDK
  // takes booleans/numbers as strings for websocket query options.
  let dgConn;
  try {
    dgConn = await deepgram.listen.v1.createConnection({
      model,
      language,
      smart_format,
      encoding,
      sample_rate,
      channels,
    });
  } catch (error) {
    console.error('Failed to create Deepgram connection:', error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Failed to reach Deepgram');
    }
    activeConnections.delete(clientWs);
    return;
  }

  let clientMessageCount = 0;
  let deepgramMessageCount = 0;

  // Route a control message (KeepAlive / Finalize / CloseStream) from the
  // browser to the matching SDK method.
  function dispatchControl(msg) {
    try {
      switch (msg.type) {
        case 'KeepAlive':
          dgConn.sendKeepAlive({ type: 'KeepAlive' });
          break;
        case 'Finalize':
          dgConn.sendFinalize({ type: 'Finalize' });
          break;
        case 'CloseStream':
          dgConn.sendCloseStream({ type: 'CloseStream' });
          break;
        default:
          console.warn('Ignoring unknown client control message type:', msg.type);
      }
    } catch (error) {
      console.error('Failed to forward control message to Deepgram:', error.message);
    }
  }

  // Deepgram -> browser (all listen messages are JSON: Results / Metadata / ...)
  dgConn.on('message', (data) => {
    deepgramMessageCount++;
    if (deepgramMessageCount % 10 === 0) {
      console.log(`← Deepgram message #${deepgramMessageCount} (type: ${data && data.type})`);
    }
    if (clientWs.readyState === WebSocket.OPEN) {
      // The SDK delivers parsed JSON objects; forward as-is if it ever hands
      // back a raw string to avoid double-encoding.
      clientWs.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  });

  dgConn.on('open', () => {
    console.log('✓ Connected to Deepgram STT API');
  });

  dgConn.on('error', (error) => {
    console.error('Deepgram socket error:', error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Deepgram connection error');
    }
  });

  dgConn.on('close', () => {
    console.log('Deepgram connection closed');
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, 'Deepgram connection closed');
    }
  });

  // browser -> Deepgram. Binary frames are audio; text frames are JSON control.
  clientWs.on('message', (data, isBinary) => {
    clientMessageCount++;
    if (clientMessageCount % 100 === 0 || !isBinary) {
      console.log(`→ Client message #${clientMessageCount} (binary: ${isBinary}, size: ${data.byteLength || data.length})`);
    }

    if (isBinary) {
      if (!dgReady) {
        pending.push({ binary: true, data });
        return;
      }
      try {
        dgConn.sendMedia(data);
      } catch (error) {
        console.error('Failed to send audio to Deepgram:', error.message);
      }
      return;
    }

    // Text frame — a JSON control message.
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.warn('Ignoring non-JSON text message from client');
      return;
    }
    if (!dgReady) {
      pending.push({ binary: false, msg });
      return;
    }
    dispatchControl(msg);
  });

  clientWs.on('close', (code, reason) => {
    console.log(`Client disconnected: ${code} ${reason}`);
    try {
      dgConn.close();
    } catch {
      // already closed
    }
    activeConnections.delete(clientWs);
  });

  clientWs.on('error', (error) => {
    console.error('Client WebSocket error:', error);
    try {
      dgConn.close();
    } catch {
      // already closed
    }
  });

  // Open the Deepgram connection and flush anything the browser sent early.
  try {
    dgConn.connect();
    await dgConn.waitForOpen();
    dgReady = true;
    for (const item of pending) {
      if (item.binary) {
        try {
          dgConn.sendMedia(item.data);
        } catch (error) {
          console.error('Failed to send buffered audio to Deepgram:', error.message);
        }
      } else {
        dispatchControl(item.msg);
      }
    }
    pending.length = 0;
  } catch (error) {
    console.error('Deepgram connection did not open:', error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Deepgram connection failed to open');
    }
  }
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
    console.log('WebSocket server closed to new connections');
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
  console.log(`📡 GET  /api/metadata`);
  console.log("=".repeat(70) + "\n");
});
