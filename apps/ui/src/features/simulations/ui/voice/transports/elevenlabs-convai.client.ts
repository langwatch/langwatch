/**
 * The ElevenLabs Conversational AI browser client.
 *
 * This is the ONE browser module that names ElevenLabs or imports its SDK.
 * The panel speaks only of a {@link VoiceTransportClient}: it hands over a
 * signed URL and a set of handlers, and gets back a session it can hang up.
 * The key never reaches here — the server minted the signed URL.
 */

import { Conversation } from "@elevenlabs/client";
import type {
  VoiceCallHandlers,
  VoiceCallSession,
  VoiceTransportClient,
} from "../voice-transport-client.registry";

export const elevenLabsConvaiClient: VoiceTransportClient = {
  async openCall({
    signedUrl,
    handlers,
  }: {
    signedUrl: string;
    handlers: VoiceCallHandlers;
  }): Promise<VoiceCallSession> {
    const conversation = await Conversation.startSession({
      signedUrl,
      onConnect: ({ conversationId }: { conversationId: string }) =>
        handlers.onConnected({ conversationId }),
      onDisconnect: () => handlers.onDisconnect(),
      onError: (message: string) => handlers.onError(new Error(message)),
      onModeChange: ({ mode }: { mode: "speaking" | "listening" }) =>
        handlers.onModeChange?.(mode),
      onMessage: ({
        message,
        source,
      }: {
        message: string;
        source: "user" | "ai";
      }) =>
        handlers.onTranscript({
          role: source === "ai" ? "agent" : "caller",
          text: message,
        }),
    });

    return {
      hangUp: () => conversation.endSession(),
      getInputVolume: () => conversation.getInputVolume(),
    };
  },
};
