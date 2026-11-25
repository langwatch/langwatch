/**
 * The provider usage langevals reports on an evaluation or a clustering answer is written to
 * the gateway spend ledger under the project, one row per call and model (ADR-193).
 */
import type { GatewayApi } from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import type { LangevalsChannel } from "../../../../channels/langevals.channel.ts";
import { MemoryProviderSpendChannel } from "../../../../channels/memory/memory.provider-spend.channel.ts";
import { LangevalsClusteringService } from "../langevals-clustering.service.ts";
import { LangevalsEvaluatorService } from "../langevals-evaluator.service.ts";
import { LangevalsProviderSpendService } from "../langevals-provider-spend.service.ts";

const EMBEDDINGS_USAGE = {
  model: "openai/text-embedding-3-large",
  calls: 412,
  input_tokens: 1_200_000,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  reasoning_tokens: 0,
};

function answering(body: unknown): LangevalsChannel {
  return { post: async () => Response.json(body) };
}

const noStaging = {
  stage: async () => {
    throw new Error("nothing is parked in this test");
  },
};

describe("LangevalsClusteringService provider usage", () => {
  /** @scenario A topic clustering run reports the provider usage of its embeddings */
  it("writes the embedding usage the answer reports to the ledger under the project", async () => {
    const ledger = MemoryProviderSpendChannel.create();
    const service = LangevalsClusteringService.create({
      endpoint: "https://langevals.example",
      langevals: answering({
        topics: [],
        subtopics: [],
        traces: [],
        cost: { amount: 0, currency: "USD" },
        usage: [EMBEDDINGS_USAGE],
      }),
      staging: noStaging,
      spend: LangevalsProviderSpendService.create({ spend: ledger }),
    });

    const outcome = await service.request({
      projectId: "project-1",
      signal: new AbortController().signal,
      mode: "batch",
      params: {
        project_id: "project-1",
        litellm_params: { model: "openai/gpt-5-mini" },
        embeddings_litellm_params: { model: "openai/text-embedding-3-large" },
        traces: [],
      },
    });

    expect(outcome.kind).toBe("clustered");
    expect(ledger.recorded).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        model: "openai/text-embedding-3-large",
        requestType: "topic_clustering",
        requestId: expect.stringMatching(/^topic_clustering:.+:openai\/text-embedding-3-large$/),
        usage: expect.objectContaining({ input_tokens: 1_200_000, output_tokens: 0 }),
      }),
    ]);
  });

  /** @scenario A retried topic clustering page reports its provider usage under the same request id */
  it("keys the usage on the page it serves, so a retry repeats the same request id", async () => {
    const ledger = MemoryProviderSpendChannel.create();
    const service = LangevalsClusteringService.create({
      endpoint: "https://langevals.example",
      langevals: answering({
        topics: [],
        subtopics: [],
        traces: [],
        cost: { amount: 0, currency: "USD" },
        usage: [EMBEDDINGS_USAGE],
      }),
      staging: noStaging,
      spend: LangevalsProviderSpendService.create({ spend: ledger }),
    });
    const attempt = () =>
      service.request({
        projectId: "project-1",
        signal: new AbortController().signal,
        requestKey: "run:run-7:page-2",
        mode: "batch",
        params: {
          project_id: "project-1",
          litellm_params: { model: "openai/gpt-5-mini" },
          embeddings_litellm_params: { model: "openai/text-embedding-3-large" },
          traces: [],
        },
      });

    await attempt();
    await attempt();

    expect(ledger.recorded.map((entry) => entry.requestId)).toEqual([
      "topic_clustering:run:run-7:page-2:openai/text-embedding-3-large",
      "topic_clustering:run:run-7:page-2:openai/text-embedding-3-large",
    ]);
  });
});

describe("LangevalsEvaluatorService provider usage", () => {
  function evaluatorOver(spend: Pick<GatewayApi, "recordProviderUsage">, body: unknown) {
    return LangevalsEvaluatorService.create({
      config: { endpoint: "https://langevals.example", maxRetries: 0, timeoutMs: 5_000 },
      langevals: answering(body),
      staging: noStaging,
      spend: LangevalsProviderSpendService.create({ spend }),
    });
  }

  /** @scenario An evaluator entry reports the provider usage of its model calls */
  it("writes the judge model's usage keyed by the evaluation's idempotency key", async () => {
    const ledger = MemoryProviderSpendChannel.create();
    const service = evaluatorOver(ledger, [
      {
        status: "processed",
        score: 1,
        passed: true,
        usage: [
          {
            ...EMBEDDINGS_USAGE,
            model: "openai/gpt-5.6-luna",
            input_tokens: 900,
            output_tokens: 40,
          },
        ],
      },
    ]);

    const result = await service.evaluate({
      evaluatorType: "langevals/llm_boolean",
      data: { input: "x" },
      settings: {},
      env: {},
      idempotencyKey: "eval-1",
      projectId: "project-1",
    });

    expect(result.status).toBe("processed");
    expect(ledger.recorded).toEqual([
      expect.objectContaining({
        requestId: "evaluation:eval-1:openai/gpt-5.6-luna",
        projectId: "project-1",
        requestType: "evaluation",
        usage: expect.objectContaining({ input_tokens: 900, output_tokens: 40 }),
      }),
    ]);
  });

  /** @scenario A ledger that cannot take the usage never fails the evaluation */
  it("keeps the verdict when the ledger refuses the usage", async () => {
    const service = evaluatorOver(
      {
        recordProviderUsage: async () => {
          throw new Error("spend pipeline down");
        },
      },
      [
        {
          status: "processed",
          score: 1,
          usage: [{ ...EMBEDDINGS_USAGE, model: "openai/gpt-5-nano" }],
        },
      ],
    );

    const result = await service.evaluate({
      evaluatorType: "langevals/llm_boolean",
      data: {},
      settings: {},
      env: {},
      projectId: "project-1",
    });

    expect(result.status).toBe("processed");
  });

  it("writes nothing for a result with no usage, a malformed block or only zero counts", async () => {
    const ledger = MemoryProviderSpendChannel.create();
    for (const usage of [
      undefined,
      "garbage",
      [{ model: "openai/gpt-5-nano" }],
      [{ input_tokens: 5 }],
    ]) {
      await evaluatorOver(ledger, [{ status: "processed", score: 1, usage }]).evaluate({
        evaluatorType: "langevals/llm_boolean",
        data: {},
        settings: {},
        env: {},
        projectId: "project-1",
      });
    }

    expect(ledger.recorded).toEqual([]);
  });
});
