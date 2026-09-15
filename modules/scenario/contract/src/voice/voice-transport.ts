/**
 * The transports a voice call can run over. A string-literal union rather
 * than an enum, matched everywhere a transport key selects a runner
 * ({@link voiceTransportRegistry}), a client ({@link
 * VoiceTransportClient}), or is carried on a session token.
 *
 * Contract-legal: no transport lives here, only the keys that name one.
 */
export const VOICE_TRANSPORTS = ["elevenlabs_convai", "phone"] as const;

export type VoiceTransport = (typeof VOICE_TRANSPORTS)[number];
