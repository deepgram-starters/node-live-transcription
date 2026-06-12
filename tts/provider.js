/**
 * TTS Provider Interface (contract)
 *
 * This file documents the abstraction boundary that every TTS provider adapter
 * must implement. It contains no runtime code — it is the typed contract that
 * `tts/index.js` (the registry) and `server.js` (the WS proxy) rely on so the
 * rest of the app never needs to know which provider is in use.
 *
 * A provider module exports a `createSession(options)` factory that returns a
 * `TtsSession`. A `TtsSession` is an EventEmitter that hides the provider's
 * wire protocol behind a small, provider-agnostic surface:
 *
 *   Methods
 *   -------
 *   start()        Open the upstream connection and prepare a synthesis context.
 *   speak(text)    Queue/synthesize a chunk of text. Safe to call before the
 *                  context is ready — implementations must buffer until ready.
 *   flush()        Tell the provider to emit all audio buffered so far.
 *   close()        End the context and close the upstream connection.
 *
 *   Events (normalized — identical names across every provider)
 *   ------
 *   'connected'      (info)        Upstream connection/auth succeeded.
 *   'ready'          (info)        Synthesis context created; speak() will flow.
 *   'audio'          (Buffer)      A chunk of raw audio bytes (already base64-decoded).
 *   'flushCompleted' (info)        All audio for the last flush has been sent.
 *   'contextClosed'  (info)        The synthesis context was closed.
 *   'providerError'  ({message})   A recoverable, provider-reported error.
 *   'error'          (Error)       A transport/connection error.
 *   'close'          (code,reason) The upstream connection closed.
 *
 * @typedef {Object} TtsSessionOptions
 * @property {string}  apiKey         Provider API key.
 * @property {string}  [wsUrl]        Override upstream URL (else provider default).
 * @property {string}  [voiceId]      Voice identifier.
 * @property {string}  [audioEncoding] e.g. 'LINEAR16' | 'MULAW' | 'OGG_OPUS'.
 * @property {number}  [sampleRate]   Sample rate in Hz.
 * @property {number}  [speed]        Playback rate multiplier.
 * @property {number}  [stability]    Voice stability (provider-specific scale).
 * @property {number}  [similarity]   Voice similarity (provider-specific scale).
 * @property {string}  [contextId]    Caller-supplied session/context id.
 *
 * @typedef {import('events').EventEmitter} TtsSession
 *
 * @typedef {Object} TtsProvider
 * @property {(options: TtsSessionOptions) => TtsSession} createSession
 */

module.exports = {};
