import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Readable } from 'stream';
import https from 'https';
import http from 'http';
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
 * Validates a stream URL
 * @param {string} url - The URL to validate
 * @returns {boolean} True if valid
 */
function isValidStreamUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Fetches an HTTP/HTTPS audio stream and returns a readable stream
 * @param {string} streamUrl - URL of the audio stream to fetch
 * @returns {Promise<Readable>} A readable stream of audio data
 */
async function fetchAudioStream(streamUrl) {
  return new Promise((resolve, reject) => {
    const protocol = streamUrl.startsWith('https:') ? https : http;

    const request = protocol.get(streamUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch stream: HTTP ${response.statusCode}`));
        return;
      }

      // Validate content type (should be audio)
      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('audio') && !contentType.includes('mpeg') && !contentType.includes('octet-stream')) {
        console.warn(`Warning: Content-Type is "${contentType}", expected audio type`);
      }

      resolve(response);
    });

    request.on('error', (error) => {
      reject(new Error(`Failed to connect to stream: ${error.message}`));
    });

    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Stream connection timeout'));
    });
  });
}

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
  const streamUrl = url.searchParams.get('stream_url');
  const mode = url.searchParams.get('mode');
  const model = url.searchParams.get('model') || 'nova-3';
  const language = url.searchParams.get('language') || 'en';

  let deepgramConnection = null;
  let audioStreamRequest = null;

  // Determine mode: stream_url (server fetches) or binary (frontend sends audio)
  const useBinaryMode = mode === 'binary';

  // Validation: Either stream_url OR mode=binary is required
  if (!streamUrl && !useBinaryMode) {
    const error = {
      error: {
        type: 'ValidationError',
        code: 'INVALID_STREAM_URL',
        message: 'stream_url parameter is required',
        details: {
          parameter: 'stream_url',
          reason: 'missing'
        }
      }
    };
    clientWs.send(JSON.stringify(error));
    clientWs.close(1008, 'Missing stream_url parameter');
    activeConnections.delete(clientWs);
    return;
  }

  // Validate URL format if stream_url is provided
  if (streamUrl && !isValidStreamUrl(streamUrl)) {
    const error = {
      error: {
        type: 'ValidationError',
        code: 'INVALID_STREAM_URL',
        message: 'Invalid stream URL format. Must use http:// or https://',
        details: {
          parameter: 'stream_url',
          value: streamUrl,
          reason: 'invalid_format'
        }
      }
    };
    clientWs.send(JSON.stringify(error));
    clientWs.close(1008, 'Invalid stream URL');
    activeConnections.delete(clientWs);
    return;
  }

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

      // If binary mode, notify client we're ready to receive audio
      if (useBinaryMode) {
        const readyMessage = {
          type: 'Ready',
          message: 'Ready to receive audio'
        };
        clientWs.send(JSON.stringify(readyMessage));
      }
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

    // If using stream_url mode, fetch the audio stream
    // If using binary mode, we'll receive audio from frontend via WebSocket messages
    if (streamUrl) {
      console.log(`Fetching audio stream: ${streamUrl}`);
      const audioStream = await fetchAudioStream(streamUrl);

      // Pipe audio data to Deepgram
      audioStream.on('data', (chunk) => {
        if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
          deepgramConnection.send(chunk);
        }
      });

      audioStream.on('end', () => {
        console.log('Audio stream ended');
        if (deepgramConnection) {
          deepgramConnection.finish();
        }
        clientWs.close(1000, 'Stream ended');
      });

      audioStream.on('error', (error) => {
        console.error('Audio stream error:', error);
        const errorMessage = {
          error: {
            type: 'StreamError',
            code: 'STREAM_UNREACHABLE',
            message: `Failed to connect to audio stream: ${error.message}`,
            details: {
              stream_url: streamUrl,
              error: error.message
            }
          }
        };
        clientWs.send(JSON.stringify(errorMessage));
        clientWs.close(1011, 'Stream error');
      });

      audioStreamRequest = audioStream;
    } else {
      // Binary mode: Listen for audio data from frontend
      console.log('Binary mode: waiting for audio from frontend');

      clientWs.on('message', (data) => {
        // Forward binary audio to Deepgram
        if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
          deepgramConnection.send(data);
        }
      });
    }

  } catch (error) {
    console.error('Error setting up transcription:', error);

    // Determine error type
    let errorCode = 'CONNECTION_FAILED';
    if (error.message.includes('timeout')) {
      errorCode = 'STREAM_UNREACHABLE';
    } else if (error.message.includes('connect to stream') || error.message.includes('fetch stream')) {
      errorCode = 'STREAM_UNREACHABLE';
    }

    const errorMessage = {
      error: {
        type: 'ConnectionError',
        code: errorCode,
        message: error.message,
        details: {
          stream_url: streamUrl
        }
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

    // Clean up audio stream
    if (audioStreamRequest) {
      audioStreamRequest.destroy();
    }

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
