/**
 * Browser registry of voice transports: one client per transport, so the panel
 * never imports a vendor symbol. A later transport (phone) is a new entry here.
 *
 * The mirror of the server's `voice-transport.registry.ts`: the server mints
 * the signed URL, the client opens the call from it.
 */

import type { VoiceTransport } from "~/server/agents/voice/voice-agent.config";
import { elevenLabsConvaiClient } from "./transports/elevenlabs-convai.client";

/** One transcript turn as it arrives live from the transport. */
export interface VoiceTurn {
  role: "caller" | "agent";
  text: string;
}

export interface VoiceCallHandlers {
  onConnected: (info: { conversationId: string }) => void;
  onTranscript: (turn: VoiceTurn) => void;
  onModeChange?: (mode: "speaking" | "listening") => void;
  onDisconnect: () => void;
  onError: (error: Error) => void;
}

export interface VoiceCallSession {
  /** End the call and release the microphone. */
  hangUp: () => Promise<void>;
  /** Current mic input level 0..1, for the live meter, when the transport
   *  exposes it. */
  getInputVolume?: () => number;
}

export interface VoiceTransportClient {
  openCall(input: {
    signedUrl: string;
    handlers: VoiceCallHandlers;
  }): Promise<VoiceCallSession>;
}

export const voiceTransportClientRegistry: Record<
  VoiceTransport,
  VoiceTransportClient
> = {
  elevenlabs_convai: elevenLabsConvaiClient,
};
