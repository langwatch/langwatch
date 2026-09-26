/**
 * The voice runtime: the transports that place and read a call. Kept off the
 * public index because they value-import the ElevenLabs SDK, which drags grpc,
 * ffmpeg-static and `open` behind it. Server-side callers import this path.
 */
export { createVoiceTransportRegistry } from "./voice-transport.registry.ts";
export type {
  ElevenLabsCredential,
  VoiceSessionConnect,
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "./voice-transport.registry.ts";
export type { VoiceTransport } from "./voice-transport.ts";
export { PHONE_NO_CREDENTIAL_MESSAGE } from "./transports/phone.transport.ts";
export {
  authorizeRecordingPlayback,
  finishVoiceSession,
  mintVoiceSession,
  VoiceAgentRowNotFoundError,
  VoiceAgentsGateDisabledError,
  VoiceKeyMissingError,
  VoiceRecordingUnavailableError,
  VoiceSessionInvalidError,
} from "./voice-session.service.ts";
export { proxyAudioStream } from "./audio-proxy-stream.ts";
export { voiceCallMaxSeconds } from "./voice-limits.ts";
