/**
 * TTS provider registry.
 *
 * Maps a provider name (from the `?provider=` query param or the TTS_PROVIDER
 * env var) to a provider module implementing the `TtsProvider` contract in
 * `tts/provider.js`. To add another provider (e.g. Deepgram /v1/speak), write
 * an adapter exposing `createSession(options)` and register it here — no other
 * part of the app needs to change.
 */

const sixtydb = require('./sixtydb');

/** @type {Record<string, import('./provider').TtsProvider>} */
const PROVIDERS = {
  sixtydb,
};

/**
 * @param {string} name
 * @returns {import('./provider').TtsProvider}
 */
function getTtsProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown TTS provider: "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return provider;
}

module.exports = { getTtsProvider, PROVIDERS };
