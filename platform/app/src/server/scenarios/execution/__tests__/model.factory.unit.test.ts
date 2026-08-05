/**
 * @vitest-environment node
 */

import { generateText, tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createJudgeModelFromParams,
  createModelFromParams,
} from "../model.factory";

const successResponse = {
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 1,
  model: "gpt-5.6-sol",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "ok" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

describe("scenario model factory", () => {
  let requestBodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    requestBodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify(successResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function callWithJudgeTool(
    model: ReturnType<typeof createModelFromParams>,
    providerOptions?: Record<string, Record<string, unknown>>,
  ) {
    await generateText({
      model,
      prompt: "Judge this conversation",
      tools: {
        submitJudgment: tool({
          description: "Submit the verdict",
          inputSchema: z.object({ passed: z.boolean() }),
        }),
      },
      toolChoice: "required",
      providerOptions,
    });
    return requestBodies.at(-1);
  }

  /** @scenario "The affected gpt-5.6 judge disables reasoning by default" */
  it.each([
    "luna",
    "sol",
    "terra",
  ])("sets reasoning_effort=none on the gpt-5.6-%s judge request", async (variant) => {
    const body = await callWithJudgeTool(
      createJudgeModelFromParams({
        litellmParams: {
          model: `openai/gpt-5.6-${variant}`,
          api_key: "test-key",
        },
        nlpServiceUrl: "http://nlp.test",
      }),
    );

    expect(body?.reasoning_effort).toBe("none");
    expect(body?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function" })]),
    );
  });

  it("does not change the simulator or target model using the same model id", async () => {
    const body = await callWithJudgeTool(
      createModelFromParams({
        litellmParams: {
          model: "openai/gpt-5.6-sol",
          api_key: "test-key",
        },
        nlpServiceUrl: "http://nlp.test",
      }),
    );

    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it.each([
    "openai/gpt-5.6-sol-pro",
    "azure/gpt-5.6-sol",
    "openai/gpt-5.5-sol",
  ])("does not speculate about the unverified judge model %s", async (modelId) => {
    const body = await callWithJudgeTool(
      createJudgeModelFromParams({
        litellmParams: { model: modelId, api_key: "test-key" },
        nlpServiceUrl: "http://nlp.test",
      }),
    );

    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("uses none only as a default, preserving explicit call intent", async () => {
    const body = await callWithJudgeTool(
      createJudgeModelFromParams({
        litellmParams: {
          model: "openai/gpt-5.6-sol",
          api_key: "test-key",
        },
        nlpServiceUrl: "http://nlp.test",
      }),
      { openai: { reasoningEffort: "high" } },
    );

    expect(body?.reasoning_effort).toBe("high");
  });
});
