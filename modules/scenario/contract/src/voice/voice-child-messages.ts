/**
 * The IPC messages a voice scenario child and its parent exchange: the Twilio stream-nonce
 * registration, its ack, the upgrade refusal, and the media-socket handoff. Both halves read
 * them, so they live here; the sending and receiving code stays with each side.
 */

import { z } from "zod";

/** Discriminates the child's registration request from other IPC messages. */
export const VOICE_NONCE_REGISTER_MESSAGE = "voice:register-nonce" as const;

/** Discriminates the parent's ack from other IPC messages. */
export const VOICE_NONCE_REGISTER_ACK_MESSAGE = "voice:register-nonce-ack" as const;

/** Discriminates the parent's upgrade-refusal notice from other IPC messages. */
export const VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE = "voice:media-upgrade-refused" as const;

/** Discriminates the socket handoff from every other child IPC message. */
export const VOICE_MEDIA_SOCKET_MESSAGE = "voice:twilio-media-socket" as const;

/** Child -> parent: register `nonce` against the sending child. */
export const voiceNonceRegisterMessageSchema = z.object({
  type: z.literal(VOICE_NONCE_REGISTER_MESSAGE),
  /** Correlates the ack to this request, so a stray or duplicate ack resolves no other wait. */
  requestId: z.string(),
  nonce: z.string(),
});
export type VoiceNonceRegisterMessage = z.infer<typeof voiceNonceRegisterMessageSchema>;

/** Parent -> child: the outcome of one registration request. */
export const voiceNonceRegisterAckMessageSchema = z.object({
  type: z.literal(VOICE_NONCE_REGISTER_ACK_MESSAGE),
  requestId: z.string(),
  ok: z.boolean(),
  /** Present only when `ok` is false. It reaches the child's own error message, never a browser. */
  error: z.string().optional(),
});
export type VoiceNonceRegisterAckMessage = z.infer<typeof voiceNonceRegisterAckMessageSchema>;

/** Parent -> child: the listener refused Twilio's dial-back, so the child fails fast. */
export const voiceMediaUpgradeRefusedMessageSchema = z.object({
  type: z.literal(VOICE_MEDIA_UPGRADE_REFUSED_MESSAGE),
  /** Human-readable cause, e.g. "nonce expired"; it dies inside the run's own error message. */
  reason: z.string(),
});
export type VoiceMediaUpgradeRefusedMessage = z.infer<typeof voiceMediaUpgradeRefusedMessageSchema>;

/**
 * Parent -> child, beside the socket handle: everything the child needs to finish the WebSocket
 * handshake itself. The head bytes travel as base64, since IPC JSON cannot carry a Buffer intact.
 */
export const voiceMediaSocketMessageSchema = z.object({
  type: z.literal(VOICE_MEDIA_SOCKET_MESSAGE),
  /** The nonce the upgrade authenticated with, for the child's own logging. */
  nonce: z.string(),
  /** The upgrade request path, e.g. `/twilio/<nonce>`. */
  url: z.string(),
  /** The upgrade request method (always GET for a WebSocket upgrade). */
  method: z.string(),
  /** The upgrade request headers, needed to compute the Sec-WebSocket-Accept. */
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.undefined()])),
  /** Base64 of the bytes read off the socket during the upgrade (the head). */
  headBase64: z.string(),
});
export type VoiceMediaSocketMessage = z.infer<typeof voiceMediaSocketMessageSchema>;

/** Narrows an arbitrary IPC message to the nonce registration request. */
export function isVoiceNonceRegisterMessage(
  message: unknown,
): message is VoiceNonceRegisterMessage {
  return voiceNonceRegisterMessageSchema.validate(message);
}

/** Narrows an arbitrary IPC message to the nonce registration ack. */
export function isVoiceNonceRegisterAckMessage(
  message: unknown,
): message is VoiceNonceRegisterAckMessage {
  return voiceNonceRegisterAckMessageSchema.validate(message);
}

/** Narrows an arbitrary IPC message to the upgrade-refusal notice. */
export function isVoiceMediaUpgradeRefusedMessage(
  message: unknown,
): message is VoiceMediaUpgradeRefusedMessage {
  return voiceMediaUpgradeRefusedMessageSchema.validate(message);
}

/**
 * Narrows an arbitrary IPC message to the socket handoff, every field checked rather than the
 * discriminator alone: a malformed `headBase64` would otherwise reach `Buffer.from` in the child.
 */
export function isVoiceMediaSocketMessage(message: unknown): message is VoiceMediaSocketMessage {
  return voiceMediaSocketMessageSchema.validate(message);
}
