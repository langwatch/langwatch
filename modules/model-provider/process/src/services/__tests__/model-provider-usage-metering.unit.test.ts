/**
 * A platform call through the execution proxy writes its answered usage to the gateway spend
 * ledger, whether generated or streamed, and a ledger refusal never fails the call (ADR-193).
 * @see modules/gateway/specs/gateway-platform-provider-usage.feature
 */
import { generateText, streamText } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";

import { MemoryModelProviderSpendChannel } from "../../channels/memory/memory.model-provider-spend.channel.ts";
import { ModelProviderUsageMeteringService } from "../model-provider-usage-metering.service.ts";

const USAGE = {
  inputTokens: { total: 1_200, noCache: 1_000, cacheRead: 200, cacheWrite: 0 },
  outputTokens: { total: 80, text: 70, reasoning: 10 },
};

const CALL = {
  projectId: "project-1",
  model: "openai/gpt-5-mini",
  modelProviderId: "mp_openai",
  featureKey: "prompt.create_default",
};

function answering(): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "hello" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: USAGE,
      warnings: [],
      response: { id: "chatcmpl-1" },
    }),
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "response-metadata", id: "chatcmpl-2" },
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "hello" },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: USAGE },
        ],
      }),
    }),
  });
}

describe("ModelProviderUsageMeteringService", () => {
  /** @scenario A platform feature or playground call through the execution proxy lands on the ledger */
  it("writes a generated call's uncached input, cache reads and output under its project and row", async () => {
    const ledger = MemoryModelProviderSpendChannel.create();
    const metering = ModelProviderUsageMeteringService.create({ spend: ledger });

    const { text } = await generateText({
      model: metering.metered(answering(), CALL),
      prompt: "hi",
    });

    expect(text).toBe("hello");
    expect(ledger.recorded).toEqual([
      expect.objectContaining({
        requestId: "platform:prompt.create_default:chatcmpl-1",
        projectId: "project-1",
        model: "openai/gpt-5-mini",
        modelProviderId: "mp_openai",
        requestType: "platform",
        usage: {
          input_tokens: 1_000,
          output_tokens: 80,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 0,
          reasoning_tokens: 10,
        },
      }),
    ]);
  });

  /** @scenario A platform feature or playground call through the execution proxy lands on the ledger */
  it("writes a streamed call's usage once the stream finishes", async () => {
    const ledger = MemoryModelProviderSpendChannel.create();
    const metering = ModelProviderUsageMeteringService.create({ spend: ledger });

    const result = streamText({
      model: metering.metered(answering(), { ...CALL, featureKey: "playground" }),
      prompt: "hi",
    });

    expect(await result.text).toBe("hello");
    expect(ledger.recorded.map((entry) => entry.requestId)).toEqual([
      "platform:playground:chatcmpl-2",
    ]);
  });

  /** @scenario A ledger that cannot take the usage never fails the evaluation */
  it("keeps the answer when the ledger refuses the usage", async () => {
    const metering = ModelProviderUsageMeteringService.create({
      spend: {
        recordProviderUsage: async () => {
          throw new Error("spend pipeline not connected");
        },
      },
    });

    const { text } = await generateText({
      model: metering.metered(answering(), CALL),
      prompt: "hi",
    });

    expect(text).toBe("hello");
  });

  it("hands the model back unchanged when no ledger is composed", () => {
    const model = answering();

    expect(
      ModelProviderUsageMeteringService.create({ spend: undefined }).metered(model, CALL),
    ).toBe(model);
  });
});
