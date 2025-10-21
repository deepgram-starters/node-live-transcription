const http = require("http");
const WebSocket = require("ws");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const dotenv = require("dotenv");
const https = require("https");
const httpLib = require("http");
const url = require("url");
dotenv.config();

const server = http.createServer();
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
let keepAlive;

const setupDeepgram = (ws, model = "nova-3", language = "en") => {
  const deepgram = deepgramClient.listen.live({
    model: model,
    language: language,
    interim_results: true,
  });

  if (keepAlive) clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    console.log("deepgram: keepalive");
    deepgram.keepAlive();
  }, 10 * 1000);

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    console.log("deepgram: connected");

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
      console.log("deepgram: transcript received");
      console.log("ws: transcript sent to client");
      ws.send(JSON.stringify(data));
    });

    deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
      console.log("deepgram: disconnected");
      clearInterval(keepAlive);
      deepgram.finish();
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
      console.log("deepgram: error received");
      console.error(error);
      ws.send(JSON.stringify({
        type: "Error",
        error: {
          type: "ConnectionError",
          code: "CONNECTION_FAILED",
          message: "Failed to connect to Deepgram",
          details: { originalError: error.message }
        }
      }));
    });

    deepgram.addListener(LiveTranscriptionEvents.Warning, async (warning) => {
      console.log("deepgram: warning received");
      console.warn(warning);
    });

    deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
      console.log("deepgram: metadata received");
      console.log("ws: metadata sent to client");
      ws.send(JSON.stringify({
        type: "Metadata",
        request_id: data.request_id || "unknown",
        model_info: data.model_info || { name: model, version: "latest" },
        created: new Date().toISOString()
      }));
    });
  });

  return deepgram;
};

const fetchStreamAndPipeToDeepgram = (streamUrl, deepgram) => {
  return new Promise((resolve, reject) => {
    console.log(`Fetching stream from: ${streamUrl}`);

    try {
      const parsedUrl = url.parse(streamUrl);
      const client = parsedUrl.protocol === 'https:' ? https : httpLib;

      const request = client.get(streamUrl, (response) => {
        console.log(`Stream response status: ${response.statusCode}`);

        if (response.statusCode !== 200) {
          reject(new Error(`Stream returned status ${response.statusCode}`));
          return;
        }

        response.on('data', (chunk) => {
          try {
            if (deepgram.getReadyState() === 1) { // OPEN
              deepgram.send(chunk);
            }
          } catch (error) {
            console.error('Error sending chunk to Deepgram:', error);
            reject(error);
          }
        });

        response.on('end', () => {
          console.log('Stream ended');
          resolve();
        });

        response.on('error', (error) => {
          console.error('Stream error:', error);
          reject(error);
        });
      });

      request.on('error', (error) => {
        console.error('Request error:', error);
        reject(error);
      });

      request.setTimeout(10000, () => { // Reduced timeout for testing
        console.error('Request timeout');
        request.destroy();
        reject(new Error('Request timeout'));
      });
    } catch (error) {
      console.error('Error setting up stream request:', error);
      reject(error);
    }
  });
};

// Configure WebSocket server to handle the live-stt endpoint
const wss = new WebSocket.Server({
  server,
  path: '/live-stt/stream'
});

// Move the connection handler to the new endpoint
wss.on("connection", (ws, req) => {
  console.log("ws: client connected to /live-stt/stream");

  // Parse query parameters from the WebSocket URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const streamUrl = url.searchParams.get('stream_url');
  const model = url.searchParams.get('model') || 'nova-3';
  const language = url.searchParams.get('language') || 'en';

  console.log(`Query params - stream_url: ${streamUrl}, model: ${model}, language: ${language}`);

  // Validate required stream_url parameter
  if (!streamUrl) {
    console.log("ws: missing stream_url parameter");
    ws.send(JSON.stringify({
      type: "Error",
      error: {
        type: "ValidationError",
        code: "INVALID_STREAM_URL",
        message: "Missing required stream_url parameter",
        details: { required: ["stream_url"] }
      }
    }));
    setTimeout(() => ws.close(), 100); // Give client time to receive error
    return;
  }

  // Validate stream_url format
  try {
    new URL(streamUrl);
  } catch (error) {
    console.log("ws: invalid stream_url format");
    ws.send(JSON.stringify({
      type: "Error",
      error: {
        type: "ValidationError",
        code: "INVALID_STREAM_URL",
        message: "Invalid stream_url format",
        details: { provided: streamUrl }
      }
    }));
    setTimeout(() => ws.close(), 100); // Give client time to receive error
    return;
  }

  let deepgram = setupDeepgram(ws, model, language);

  // Start fetching and piping the stream
  fetchStreamAndPipeToDeepgram(streamUrl, deepgram)
    .then(() => {
      console.log("Stream processing completed");
    })
    .catch((error) => {
      console.error("Stream processing failed:", error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "Error",
          error: {
            type: "StreamError",
            code: "STREAM_UNREACHABLE",
            message: "Failed to fetch or process stream",
            details: { originalError: error.message }
          }
        }));
        setTimeout(() => ws.close(), 100);
      }
    });

  ws.on("close", () => {
    console.log("ws: client disconnected");
    if (deepgram) {
      deepgram.finish();
      deepgram.removeAllListeners();
      deepgram = null;
    }
  });
});

server.listen(3000, () => {
  console.log("Live STT Stream Server is listening on port 3000");
  console.log("WebSocket endpoint: ws://localhost:3000/live-stt/stream");
});
