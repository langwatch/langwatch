/**
 * The transports a voice call can run over: a string-literal union, matched
 * everywhere a transport key selects a runner, a client, or is carried on a
 * session token. Contract-legal: no transport lives here, only the keys.
 */
export const VOICE_TRANSPORTS = ["elevenlabs_convai", "phone"] as const;

export type VoiceTransport = (typeof VOICE_TRANSPORTS)[number];
