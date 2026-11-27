/**
 * @vitest-environment node
 * The installed scenario SDK's judge on the production judge model against a stand-in endpoint
 * behind the engine proxy: what it sends is what the module tests read, and the answer is read
 * back as its verdict. No provider and no engine are reached.
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";

import {
  AgentRole,
  JudgeAgent,
  ScenarioExecutionState,
  type ScenarioConfig,
} from "@langwatch/scenario";
import {
  judgePreviewChatCompletionSchema,
  judgePreviewChatRequestSchema,
  type JudgePreviewChatCompletion,
  type LiteLLMParams,
} from "@langwatch/scenario-contract";
import { afterEach, describe, expect, it } from "vitest";

import { HttpLitellmModelChannel } from "../channels/http/http.litellm-model.channel.ts";

/** The parameters the prefetch hands a run whose judge is LangWatch Judge (preview). */
const JUDGE_PREVIEW_PARAMS: LiteLLMParams = {
  model: "openai/langwatch-judge-preview",
  api_base: "https://app.langwatch.test/api/judge-preview/v1",
  api_key: "run-key-1",
};

const CRITERIA = ["The agent offers a refund", "The agent apologises"];

/** The fixtures the module tests build their judge calls from; this suite pins them to the SDK. */
const fixture = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../../modules/${path}`, import.meta.url), "utf8"));
const SCENARIO_VERDICT_REQUEST = fixture(
  "scenario/process/src/__tests__/support/scenario-sdk-verdict-request.json",
);
const LEAF_FINISH_TEST = fixture(
  "instant-eval-judge/process/src/__tests__/support/scenario-sdk-finish-test.json",
) as { parameters: { properties: { criteria: { properties: Record<string, unknown> } } } };

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
                criteria: {
                  the_agent_offers_a_refund: {
                    requirement: "The agent offers a refund",
                    reasoning: "Met.",
                    status: "passed",
                  },
                  the_agent_apologises: {
                    requirement: "The agent apologises",
                    reasoning: "Not met.",
                    status: "failed",
                  },
                },
                reasoning: "It refunded and never apologised.",
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

const SCENARIO: ScenarioConfig = {
  name: "Late order refund",
  description: "A customer asks for a refund on a late order",
  agents: [],
  maxTurns: 10,
};

/** The SDK's judge asked for its verdict on a two-turn conversation, with no traces. */
const askForVerdict = (nlpServiceUrl: string) =>
  new JudgeAgent({
    criteria: CRITERIA,
    model: HttpLitellmModelChannel.create().judgeModel({
      litellmParams: JUDGE_PREVIEW_PARAMS,
      nlpServiceUrl,
    }),
  }).call({
    threadId: "thread-1",
    messages: [
      { role: "user", content: "my order is late" },
      { role: "assistant", content: "I refunded it" },
    ],
    newMessages: [],
    requestedRole: AgentRole.JUDGE,
    judgmentRequest: {},
    scenarioConfig: SCENARIO,
    scenarioState: new ScenarioExecutionState(SCENARIO),
  });

describe("given the scenario SDK's judge on the model the runner builds for LangWatch Judge (preview)", () => {
  describe("when it asks for a verdict with the finish_test tool forced", () => {
    /** @scenario "The scenario SDK's client reads the endpoint's answer as its tool call" */
    it("reads the endpoint's answer as one passed and one failed criterion", async () => {
      proxy = await startProxy({ status: 200, body: VERDICT_COMPLETION });

      const result = await askForVerdict(proxy.url);

      expect(result).toMatchObject({
        success: false,
        metCriteria: ["The agent offers a refund"],
        unmetCriteria: ["The agent apologises"],
        reasoning: "It refunded and never apologised.",
      });
    });

    /** @scenario "The scenario SDK's client reads the endpoint's answer as its tool call" */
    it("sends the request the module tests read, addressed to the app through the engine", async () => {
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
      expect(sent?.body).toEqual(SCENARIO_VERDICT_REQUEST);
    });

    /** @scenario "The scenario SDK's client reads the endpoint's answer as its tool call" */
    it("builds each criterion's entry as the judge leaf's fixture has it", async () => {
      proxy = await startProxy({ status: 200, body: VERDICT_COMPLETION });

      await askForVerdict(proxy.url);

      const request = judgePreviewChatRequestSchema.parse(proxy.received[0]?.body);
      const sent = request.tools?.[0]?.function as typeof LEAF_FINISH_TEST & { name: string };
      const leafEntries = Object.values(LEAF_FINISH_TEST.parameters.properties.criteria.properties);
      const sentEntries = Object.values(sent.parameters.properties.criteria.properties);
      expect(sentEntries).toEqual([leafEntries[0], leafEntries[0]]);
      const { criteria: _sentCriteria, ...sentRest } = sent.parameters.properties;
      const { criteria: _leafCriteria, ...leafRest } = LEAF_FINISH_TEST.parameters.properties;
      expect(sentRest).toEqual(leafRest);
    });
  });

  describe("when the endpoint answers that the judge is unavailable", () => {
    /** @scenario "An unavailable judge is an error, never a verdict" */
    it("reaches no verdict from the endpoint's error", async () => {
      proxy = await startProxy({
        status: 503,
        body: { error: { message: "LangWatch Judge (preview) could not answer right now" } },
      });

      const outcome = await askForVerdict(proxy.url).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );

      expect(outcome).toEqual({ error: expect.any(Error) });
    });
  });
});
