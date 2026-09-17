/**
 * The voice runtime: the transports that place and read a call. Kept off the
 * public index because they value-import the ElevenLabs SDK, which drags grpc,
 * ffmpeg-static and `open` behind it. Server-side callers import this path.
 */
export { voiceTransportRegistry } from "./voice-transport.registry.ts";
export type {
  ElevenLabsCredential,
  VoiceSessionConnect,
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "./voice-transport.registry.ts";
export { PHONE_NO_CREDENTIAL_MESSAGE, phoneTransport } from "./transports/phone.transport.ts";
