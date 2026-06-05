import { describe, expect, it } from "vitest";
import scenario, { voice } from "@langwatch/scenario";

describe("voice factory surface (documented in scenarios skill)", () => {
  it("constructs every voice adapter factory the skill documents", () => {
    // pipecatAgent — connects to a Pipecat WebSocket server; no network at construction
    const pipecat = scenario.pipecatAgent({ url: "ws://localhost:8765/stream" });
    expect(pipecat).toBeDefined();

    // openAIRealtimeAgent — wraps OpenAI realtime session; no network at construction
    const openaiRealtime = scenario.openAIRealtimeAgent({ voice: "alloy" });
    expect(openaiRealtime).toBeDefined();

    // geminiLiveAgent — wraps Gemini Live session; no network at construction
    const geminiLive = scenario.geminiLiveAgent({ model: "gemini-2.5-flash" });
    expect(geminiLive).toBeDefined();

    // elevenLabsAgent — connects to ElevenLabs ConvAI; no network at construction
    const elevenLabs = scenario.elevenLabsAgent({ agentId: "x", apiKey: "y" });
    expect(elevenLabs).toBeDefined();

    // twilioAgent — Twilio-based PSTN adapter; no network at construction
    const twilio = scenario.twilioAgent({
      accountSid: "a",
      authToken: "b",
      phoneNumber: "+10000000000",
    });
    expect(twilio).toBeDefined();

    // composableAgent — STT→LLM→TTS pipeline; constructor only assigns, no validation
    // stt and llm are typed non-optional but the constructor does not validate at
    // runtime (it assigns options.stt / options.llm directly). Passing undefined is
    // safe at construction; errors only surface when the adapter actually runs.
    const composable = scenario.composableAgent({
      stt: undefined as any,
      llm: undefined as any,
      tts: "openai/nova",
    });
    expect(composable).toBeDefined();
  });

  it("exposes voice.effects helpers the skill documents", () => {
    // voice.effects is the effects namespace re-exported under the voice namespace
    expect(typeof voice.effects.backgroundNoise).toBe("function");
    expect(typeof voice.effects.phoneQuality).toBe("function");

    // Each call returns an EffectFn (a function the voice executor applies to
    // TTS audio). Just calling the factory should return a defined value.
    const bgNoise = voice.effects.backgroundNoise("cafe", 0.4);
    expect(bgNoise).toBeDefined();

    const phoneQuality = voice.effects.phoneQuality();
    expect(phoneQuality).toBeDefined();
  });

  it("userSimulatorAgent accepts a voice option", () => {
    const sim = scenario.userSimulatorAgent({ voice: "openai/nova" });
    expect(sim).toBeDefined();
  });
});
