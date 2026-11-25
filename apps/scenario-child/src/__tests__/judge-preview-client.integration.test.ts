/**
 * @vitest-environment node
 * The production judge model and the AI SDK against a stand-in for the judge preview endpoint
 * behind the engine proxy: what the client sends is what the endpoint reads, and the endpoint's
 * answer is read back as the judge's tool call. No provider and no engine are reached.
 */

import { createServer, type Server } from "node:http";

import {
  judgePreviewChatCompletionSchema,
  judgePreviewChatRequestSchema,
  type JudgePreviewChatCompletion,
  type LiteLLMParams,
} from "@langwatch/scenario-contract";
import { generateText, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { HttpLitellmModelChannel } from "../channels/http/http.litellm-model.channel.ts";

/** The parameters the prefetch hands a run whose judge is LangWatch Judge (preview). */
const JUDGE_PREVIEW_PARAMS: LiteLLMParams = {
  model: "openai/langwatch-judge-preview",
  api_base: "https://app.langwatch.test/api/judge-preview/v1",
  api_key: "run-key-1",
};

/** The verdict tool as the scenario SDK's judge builds it, with made-up criteria. */
const finishTest = tool({
  description: "Complete the test with a final verdict",
  inputSchema: z.object({
    criteria: z
      .object({
        the_agent_offers_a_refund: z
          .enum(["true", "false", "inconclusive"])
          .describe("The agent offers a refund"),
        the_agent_apologises: z
          .enum(["true", "false", "inconclusive"])
          .describe("The agent apologises"),
      })
      .strict()
      .describe("Strict verdict for each criterion"),
    reasoning: z.string().describe("Explanation of what the final verdict should be"),
    verdict: z
      .enum(["success", "failure", "inconclusive"])
      .describe("The final verdict of the test"),
  }),
});

/** The endpoint's answer to a verdict call, in the shape its contract publishes. */
const VERDICT_COMPLETION: JudgePreviewChatCompletion = judgePreviewChatCompletionSchema.parse({
  id: "chatcmpl_1",
  object: "chat.completion",
  created: 1_760_000_000,
  model: "langwatch/judge-preview",
  choices: [
    {
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_chatcmpl_1",
            type: "function",
            function: {
              name: "finish_test",
              arguments: JSON.stringify({
                criteria: { the_agent_offers_a_refund: "true", the_agent_apologises: "false" },
                reasoning: "It refunded and never apologised.",
                verdict: "failure",
              }),
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 900, completion_tokens: 0, total_tokens: 900 },
});

type Received = Readonly<{ path: string; headers: Record<string, unknown>; body: unknown }>;

/** Plays the engine proxy in front of the endpoint: keeps what arrived, answers as scripted. */
async function startProxy(answer: { status: number; body: unknown }) {
  const received: Received[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      });
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
});

const askForVerdict = (nlpServiceUrl: string) =>
  generateText({
    model: HttpLitellmModelChannel.create().judgeModel({
      litellmParams: JUDGE_PREVIEW_PARAMS,
      nlpServiceUrl,
    }),
    messages: [
      { role: "system", content: "<scenario>\nA customer asks for a refund\n</scenario>" },
      { role: "user", content: "<transcript>user: my order is late</transcript>" },
    ],
    tools: { finish_test: finishTest },
    toolChoice: { type: "tool", toolName: "finish_test" },
    maxRetries: 0,
  });

describe("given the judge model the runner builds for LangWatch Judge (preview)", () => {
  describe("when it asks for a verdict with the finish_test tool forced", () => {
    /** @scenario "The scenario SDK's client reads the endpoint's answer as its tool call" */
    it("reads one finish_test tool call with the criteria by key", async () => {
      proxy = await startProxy({ status: 200, body: VERDICT_COMPLETION });

      const result = await askForVerdict(proxy.url);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        toolName: "finish_test",
        input: {
          criteria: { the_agent_offers_a_refund: "true", the_agent_apologises: "false" },
          reasoning: "It refunded and never apologised.",
          verdict: "failure",
        },
      });
    });

    /** @scenario "The scenario SDK's client reads the endpoint's answer as its tool call" */
    it("sends a request the endpoint's contract reads, addressed to the app through the engine", async () => {
      proxy = await startProxy({ status: 200, body: VERDICT_COMPLETION });

      await askForVerdict(proxy.url);

      const [sent] = proxy.received;
      expect(sent?.path).toBe("/go/proxy/v1/chat/completions");
      expect(sent?.headers).toMatchObject({
        "x-litellm-model": "openai/langwatch-judge-preview",
        "x-litellm-api_base": "https://app.langwatch.test/api/judge-preview/v1",
        "x-litellm-api_key": "run-key-1",
      });
      const request = judgePreviewChatRequestSchema.parse(sent?.body);
      expect(request.stream ?? false).toBe(false);
      expect(request.tools?.map((offered) => offered.function.name)).toEqual(["finish_test"]);
      const criteria = z
        .object({
          properties: z.object({
            criteria: z.object({
              properties: z.record(z.string(), z.object({ description: z.string() })),
            }),
          }),
        })
        .parse(request.tools?.[0]?.function.parameters).properties.criteria.properties;
      expect(criteria).toEqual({
        the_agent_offers_a_refund: expect.objectContaining({
          description: "The agent offers a refund",
        }),
        the_agent_apologises: expect.objectContaining({ description: "The agent apologises" }),
      });
    });
  });

  describe("when the endpoint answers that the judge is unavailable", () => {
    /** @scenario "An unavailable judge is an error, never a verdict" */
    it("throws, so the run ends as an error and no verdict is read", async () => {
      proxy = await startProxy({
        status: 503,
        body: { error: { message: "LangWatch Judge (preview) could not answer right now" } },
      });

      await expect(askForVerdict(proxy.url)).rejects.toThrow(
        "LangWatch Judge (preview) could not answer right now",
      );
    });
  });
});
