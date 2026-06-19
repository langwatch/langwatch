import { OpenAIRealtimeWebSocket } from "openai/beta/realtime/websocket";

// A minimal voice agent: connects to OpenAI's Realtime API over WebSocket and
// streams audio in/out. This is the user's *deployed voice transport* — the
// thing a voice scenario test must drive with real audio, not a text transcript.
const VOICE = "alloy";
const INSTRUCTIONS = "You are a friendly phone support agent. Greet the caller, then help with billing questions.";

export async function createVoiceAgent() {
  const rt = new OpenAIRealtimeWebSocket({ model: "gpt-4o-realtime-preview" });
  rt.socket.addEventListener("open", () => {
    rt.send({
      type: "session.update",
      session: { voice: VOICE, instructions: INSTRUCTIONS, modalities: ["audio", "text"] },
    });
  });
  return rt;
}
