import { Conversation } from "@elevenlabs/client";

import type {
  VoiceCallHandlers,
  VoiceCallSession,
  VoiceTransportClient,
} from "../model/voice-call.ts";

/** The one browser file naming ElevenLabs: it opens a call from the server-minted signed URL. */
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
      onModeChange: ({ mode }: { mode: "speaking" | "listening" }) => handlers.onModeChange?.(mode),
      onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) =>
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
