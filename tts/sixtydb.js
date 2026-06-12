/**
 * 60db TTS provider adapter.
 *
 * Wraps the 60db WebSocket TTS API (wss://api.60db.ai/ws/tts) and exposes it
 * through the provider-agnostic `TtsSession` contract documented in
 * `tts/provider.js`. The rest of the app talks to this session via normalized
 * methods/events and never sees 60db's `create_context` / `send_text` /
 * `flush_context` message protocol.
 *
 * 60db WS protocol (summarized from https://docs.60db.ai/websocket-api/tts):
 *   connect ?apiKey=...           → server: { connecting }, then { connection_established }
 *   client: { create_context }    → server: { context_created }
 *   client: { send_text }         (accumulates text, up to 50k chars)
 *   client: { flush_context }     → server: { audio_chunk }... then { flush_completed }
 *   client: { close_context }     → server: { context_closed }, then socket closes
 */

const { WebSocket } = require('ws');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const DEFAULT_WS_URL = 'wss://api.60db.ai/ws/tts';
const DEFAULT_VOICE = 'fbb75ed2-975a-40c7-9e06-38e30524a9a1';
const DEFAULT_ENCODING = 'LINEAR16';
const DEFAULT_SAMPLE_RATE = 24000;

class SixtyDbTtsSession extends EventEmitter {
  /** @param {import('./provider').TtsSessionOptions} options */
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey;
    this.wsUrl = options.wsUrl || DEFAULT_WS_URL;
    this.contextId = options.contextId || crypto.randomUUID();
    this.voiceId = options.voiceId || DEFAULT_VOICE;
    this.audioEncoding = options.audioEncoding || DEFAULT_ENCODING;
    this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
    this.speed = options.speed;
    this.stability = options.stability;
    this.similarity = options.similarity;

    this.ws = null;
    this.contextReady = false;
    this.pendingText = []; // buffered until the synthesis context is created
    this.pendingFlush = false;
  }

  start() {
    if (!this.apiKey) {
      // Defer so callers can attach listeners before the error fires.
      queueMicrotask(() => this.emit('error', new Error('60db apiKey is required')));
      return;
    }
    const url = new URL(this.wsUrl);
    url.searchParams.set('apiKey', this.apiKey);

    this.ws = new WebSocket(url.toString());
    this.ws.on('message', (data) => this._onMessage(data));
    this.ws.on('error', (err) => this.emit('error', err));
    this.ws.on('close', (code, reason) =>
      this.emit('close', code, reason ? reason.toString() : '')
    );
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // 60db audio arrives as base64 inside JSON; ignore non-JSON frames
    }

    if (msg.connection_established) {
      this.emit('connected', msg.connection_established);
      this._createContext();
      return;
    }
    if (msg.context_created) {
      this.contextReady = true;
      this.emit('ready', { contextId: this.contextId });
      // Replay anything that was requested before the context existed.
      for (const text of this.pendingText) this._sendText(text);
      this.pendingText = [];
      if (this.pendingFlush) {
        this.pendingFlush = false;
        this.flush();
      }
      return;
    }
    if (msg.audio_chunk) {
      const b64 = msg.audio_chunk.audioContent;
      if (b64) this.emit('audio', Buffer.from(b64, 'base64'));
      return;
    }
    if (msg.flush_completed) {
      this.emit('flushCompleted', { contextId: this.contextId });
      return;
    }
    if (msg.context_closed) {
      this.emit('contextClosed', { contextId: this.contextId });
      return;
    }
    if (msg.error) {
      this.emit('providerError', { message: msg.error.message || 'unknown 60db error' });
      return;
    }
  }

  _createContext() {
    const audio_config = {
      audio_encoding: this.audioEncoding,
      sample_rate_hertz: this.sampleRate,
    };
    const payload = {
      context_id: this.contextId,
      voice_id: this.voiceId,
      audio_config,
    };
    if (this.speed !== undefined) payload.speed = this.speed;
    if (this.stability !== undefined) payload.stability = this.stability;
    if (this.similarity !== undefined) payload.similarity = this.similarity;
    this._send({ create_context: payload });
  }

  speak(text) {
    if (!text) return;
    if (!this.contextReady) {
      this.pendingText.push(text);
      return;
    }
    this._sendText(text);
  }

  _sendText(text) {
    this._send({ send_text: { context_id: this.contextId, text } });
  }

  flush() {
    if (!this.contextReady) {
      this.pendingFlush = true;
      return;
    }
    this._send({ flush_context: { context_id: this.contextId } });
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._send({ close_context: { context_id: this.contextId } });
    }
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}

/**
 * @param {import('./provider').TtsSessionOptions} options
 * @returns {SixtyDbTtsSession}
 */
function createSession(options) {
  return new SixtyDbTtsSession(options);
}

module.exports = {
  createSession,
  SixtyDbTtsSession,
  DEFAULT_WS_URL,
  DEFAULT_VOICE,
  DEFAULT_ENCODING,
  DEFAULT_SAMPLE_RATE,
};
