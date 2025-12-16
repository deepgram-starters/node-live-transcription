import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

const CONFIG = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  vitePort: process.env.VITE_PORT || 5173,
  isDevelopment: process.env.NODE_ENV === 'development',
};

// Validate API Key exists
if (!process.env.DEEPGRAM_API_KEY) {
  console.error('ERROR: DEEPGRAM_API_KEY environment variable is required');
  console.error('Please copy sample.env to .env and add your API key');
  process.exit(1);
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Track all active WebSocket connections for graceful shutdown
const activeConnections = new Set();

/**
 * Handles WebSocket upgrade requests at /live-stt/stream
 */
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/live-stt/stream') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

/**
 * Handles new WebSocket connections
 */
wss.on('connection', async (clientWs, request) => {
  console.log('Client connected to /live-stt/stream');
  activeConnections.add(clientWs);

  // Parse query parameters
  const url = new URL(request.url, `http://${request.headers.host}`);
  const model = url.searchParams.get('model') || 'nova-3';
  const language = url.searchParams.get('language') || 'en';

  let deepgramConnection = null;

  // First try-catch: Create Deepgram connection
  try {
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

    deepgramConnection = deepgram.listen.live({
      model,
      language,
      smart_format: true,
    });
  } catch (error) {
    console.error('Error creating Deepgram connection:', error);

    // Send clear error to client
    const errorResponse = {
      error: {
        type: 'ConnectionError',
        code: 'DEEPGRAM_CONNECTION_FAILED',
        message: 'Failed to establish connection to Deepgram. Please check your API key.',
        details: {
          reason: error.message,
          hint: 'Verify DEEPGRAM_API_KEY is set correctly in .env'
        }
      }
    };

    clientWs.send(JSON.stringify(errorResponse));
    clientWs.close(1011, 'Deepgram connection failed');
    activeConnections.delete(clientWs);
    return;
  }

  let keepAlive;

  // Second try-catch: Set up audio streaming
  try {

    // Set up Deepgram event listeners
    deepgramConnection.on(LiveTranscriptionEvents.Open, () => {
      console.log('Deepgram connection opened');

      // Start keepalive
      keepAlive = setInterval(() => {
        if (deepgramConnection.getReadyState() === 1) {
          deepgramConnection.keepAlive();
        }
      }, 10000);

      // Notify client we're ready to receive audio
      const readyMessage = {
        type: 'Ready',
        message: 'Ready to receive audio'
      };
      clientWs.send(JSON.stringify(readyMessage));
    });

    deepgramConnection.on(LiveTranscriptionEvents.Metadata, (data) => {
      console.log('Deepgram metadata received');

      // Pass through Deepgram's metadata to client
      const metadata = {
        type: 'Metadata',
        request_id: data.request_id,
        model_info: data.model_info,
        created: data.created
      };
      clientWs.send(JSON.stringify(metadata));
    });

    deepgramConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
      // Extract transcript from Deepgram response
      const transcript = data.channel?.alternatives?.[0]?.transcript || '';
      const isFinal = data.is_final || false;
      const speechFinal = data.speech_final || false;

      if (transcript) {
        const result = {
          type: 'Results',
          transcript,
          is_final: isFinal,
          speech_final: speechFinal,
          confidence: data.channel?.alternatives?.[0]?.confidence,
          words: data.channel?.alternatives?.[0]?.words || [],
          duration: data.duration,
          start: data.start,
          metadata: {
            model: model,
            language: language
          }
        };

        clientWs.send(JSON.stringify(result));
      }
    });

    deepgramConnection.on(LiveTranscriptionEvents.Error, (error) => {
      console.error('Deepgram error:', error);
      const errorMessage = {
        error: {
          type: 'DeepgramError',
          code: 'CONNECTION_FAILED',
          message: error.message || 'Deepgram connection error',
          details: error
        }
      };
      clientWs.send(JSON.stringify(errorMessage));
    });

    deepgramConnection.on(LiveTranscriptionEvents.Close, () => {
      console.log('Deepgram connection closed');
      clearInterval(keepAlive);
    });

    // Listen for binary audio data from frontend and forward to Deepgram
    clientWs.on('message', (data) => {
      if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
        deepgramConnection.send(data);
      }
    });

  } catch (error) {
    console.error('Error setting up transcription:', error);

    const errorMessage = {
      error: {
        type: 'ConnectionError',
        code: 'CONNECTION_FAILED',
        message: error.message
      }
    };

    clientWs.send(JSON.stringify(errorMessage));
    clientWs.close(1011, 'Setup error');
    activeConnections.delete(clientWs);
    return;
  }

  // Handle client disconnect
  clientWs.on('close', () => {
    console.log('Client disconnected');

    // Clean up Deepgram connection
    if (deepgramConnection) {
      deepgramConnection.finish();
      deepgramConnection.removeAllListeners();
    }

    activeConnections.delete(clientWs);
  });

  clientWs.on('error', (error) => {
    console.error('Client WebSocket error:', error);
  });
});


/**
 * In development: Proxy all requests to Vite dev server for hot reload
 * In production: Serve pre-built static files from frontend/dist
 *
 * IMPORTANT: This MUST come AFTER your WebSocket routes to avoid conflicts
 */
if (CONFIG.isDevelopment) {
  // Development: Proxy to Vite dev server
  app.use(
    "/",
    createProxyMiddleware({
      target: `http://localhost:${CONFIG.vitePort}`,
      changeOrigin: true,
      ws: true, // Enable WebSocket proxying for Vite HMR (Hot Module Reload)
    })
  );
} else {
  // Production: Serve static files from frontend/dist
  const distPath = path.join(__dirname, "frontend", "dist");
  app.use(express.static(distPath));
}

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

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log("\n" + "=".repeat(70));
  console.log(`🚀 Live STT Backend Server running at http://localhost:${CONFIG.port}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${CONFIG.port}/live-stt/stream`);
  if (CONFIG.isDevelopment) {
    console.log(`📡 Proxying frontend from Vite dev server on port ${CONFIG.vitePort}`);
    console.log(`\n⚠️  Open your browser to http://localhost:${CONFIG.port}`);
  } else {
    console.log(`📦 Serving built frontend from frontend/dist`);
  }
  console.log("=".repeat(70) + "\n");
});
