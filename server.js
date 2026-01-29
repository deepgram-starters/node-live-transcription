/**
 * Node Live Transcription Starter - Backend Server
 *
 * Simple WebSocket proxy to Deepgram's Live Transcription API.
 * Forwards all messages (JSON and binary) bidirectionally between client and Deepgram.
 */

import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import { createServer } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import toml from 'toml';

// Load environment variables
dotenv.config();

// ES module equivalents for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  port: process.env.PORT || 8080,
  host: process.env.HOST || '0.0.0.0',
  vitePort: process.env.VITE_PORT || 8081,
  isDevelopment: process.env.NODE_ENV === 'development',
};

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Track all active WebSocket connections for graceful shutdown
const activeConnections = new Set();

// Store viteProxy for WebSocket upgrade handling in dev mode
let viteProxy = null;

/**
 * Metadata endpoint (standardized) - required for standardization compliance
 */
app.get('/api/metadata', (req, res) => {
  res.json({
    name: "Node Live Transcription Starter",
    feature: "live-transcription",
    language: "JavaScript",
    framework: "Node",
    version: "1.0.0"
  });
});

/**
 * Legacy metadata endpoint - returns application metadata from deepgram.toml
 */
app.get('/metadata', (req, res) => {
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
  console.log('Client connected to /stt/stream');
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

/**
 * In development: Proxy all requests to Vite dev server for hot reload
 * In production: Serve pre-built static files from frontend/dist
 *
 * IMPORTANT: This MUST come AFTER your API routes to avoid conflicts
 */
if (CONFIG.isDevelopment) {
  console.log(`Development mode: Proxying to Vite dev server on port ${CONFIG.vitePort}`);

  // Create proxy middleware for HTTP requests only (no WebSocket)
  viteProxy = createProxyMiddleware({
    target: `http://localhost:${CONFIG.vitePort}`,
    changeOrigin: true,
    ws: false, // Disable automatic WebSocket proxying - we'll handle it manually
  });

  app.use('/', viteProxy);

  // Manually handle WebSocket upgrades at the server level
  // This allows us to selectively proxy based on path
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;

    console.log(`WebSocket upgrade request for: ${pathname}`);

    // Backend handles /stt/stream WebSocket connections directly
    if (pathname === '/stt/stream') {
      console.log('Backend handling /stt/stream WebSocket');
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
      return;
    }

    // Forward all other WebSocket connections (Vite HMR) to Vite
    console.log('Proxying WebSocket to Vite');
    viteProxy.upgrade(request, socket, head);
  });
} else {
  console.log('Production mode: Serving static files');

  const distPath = path.join(__dirname, 'frontend', 'dist');
  app.use(express.static(distPath));
}

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
  console.log(`🚀 Live STT Backend Server running at http://localhost:${CONFIG.port}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${CONFIG.port}/stt/stream`);
  if (CONFIG.isDevelopment) {
    console.log(`📡 Proxying frontend from Vite dev server on port ${CONFIG.vitePort}`);
    console.log(`\n⚠️  Open your browser to http://localhost:${CONFIG.port}`);
  } else {
    console.log(`📦 Serving built frontend from frontend/dist`);
  }
  console.log("=".repeat(70) + "\n");
});
