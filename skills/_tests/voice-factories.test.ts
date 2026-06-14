import { describe, expect, it } from "vitest";
import scenario, { voice } from "@langwatch/scenario";
import { openai } from "@ai-sdk/openai";

describe("voice factory surface (documented in scenarios skill)", () => {
  it.each([
    ["pipecatAgent", () => scenario.pipecatAgent({ url: "ws://localhost:8765/stream" })],
    ["openAIRealtimeAgent", () => scenario.openAIRealtimeAgent({ voice: "alloy" })],
    ["geminiLiveAgent", () => scenario.geminiLiveAgent({ model: "gemini-2.5-flash" })],
    [
      "elevenLabsAgent",
      () => scenario.elevenLabsAgent({ agentId: "x", apiKey: "y" }),
    ],
    [
      "twilioAgent",
      () =>
        scenario.twilioAgent({
          accountSid: "a",
          authToken: "b",
          phoneNumber: "+10000000000",
        }),
    ],
  ])("constructs %s without network", (_name, factory) => {
    expect(factory()).toBeDefined();
  });

  it("constructs composableAgent with documented stt/llm/tts values", () => {
    const composable = scenario.composableAgent({
      stt: "openai/whisper-1",
      llm: openai("gpt-5-mini"),
      tts: "openai/nova",
    });
    expect(composable).toBeDefined();
  });

  it("exposes voice.effects helpers the skill documents", () => {
    expect(typeof voice.effects.backgroundNoise).toBe("function");
    expect(typeof voice.effects.phoneQuality).toBe("function");

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
