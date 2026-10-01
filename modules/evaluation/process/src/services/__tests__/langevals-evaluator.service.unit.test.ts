/**
 * @vitest-environment node
 */
import { EvaluatorExecutionError } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpLangevalsChannel } from "../../channels/http/http.langevals.channel.ts";
import type { LangevalsPayloadStaging } from "../../channels/langevals.channel.ts";
import { NullLangevalsChannel } from "../../channels/null.langevals.channel.ts";
import { LangevalsEvaluatorService } from "../langevals-evaluator.service.ts";
import type { LangevalsEvaluateParams } from "../langevals-evaluator.service.ts";

const ENDPOINT = "http://langevals.internal.langwatch.svc.cluster.local:5562";

const params: LangevalsEvaluateParams = {
  evaluatorType: "langevals/llm_boolean",
  data: { input: "hi", output: "there" },
  settings: {},
  env: {},
};

function httpService(): LangevalsEvaluatorService {
  return LangevalsEvaluatorService.create({
    config: { endpoint: ENDPOINT, maxRetries: 0, timeoutMs: 10 },
    langevals: HttpLangevalsChannel.create({
      config: {
        stagingThresholdBytes: undefined,
        stagingTtlSeconds: 60,
        evaluationMaxPayloadBytes: 1_000_000,
        topicClusteringMaxPayloadBytes: 1_000_000,
      },
      staging: createApiFixture<LangevalsPayloadStaging>(),
    }),
  });
}

async function evaluationFailure(): Promise<EvaluatorExecutionError> {
  const thrown = await httpService()
    .evaluate(params)
    .catch((error: unknown) => error);
  if (!(thrown instanceof EvaluatorExecutionError)) {
    throw new Error("expected the evaluation to fail with EvaluatorExecutionError");
  }
  return thrown;
}

function answerWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body))),
  );
}

function failFetchWith(error: Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(error)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LangevalsEvaluatorService", () => {
  describe("given the evaluator service does not answer before the timeout", () => {
    describe("when the failure reaches the caller", () => {
      /** @scenario "An evaluator timeout names the evaluator, not the address dialled" */
      it("names the evaluator and the timeout, and not the address dialled", async () => {
        failFetchWith(
          Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
        );

        const error = await evaluationFailure();

        expect(error).toMatchObject({
          meta: { evaluatorType: "langevals/llm_boolean", timeoutMs: 10 },
        });
        expect(JSON.stringify(error)).not.toContain("cluster.local");
        expect(JSON.stringify(error.meta)).not.toContain("http");
      });
    });
  });

  describe("given the evaluator service cannot be reached", () => {
    describe("when the failure reaches the caller", () => {
      /** @scenario "An unreachable evaluator names the evaluator, not the address dialled" */
      it("names the evaluator and not the address dialled", async () => {
        failFetchWith(new Error("fetch failed"));

        const error = await evaluationFailure();

        expect(error.meta).toEqual({
          evaluatorType: "langevals/llm_boolean",
        });
        expect(JSON.stringify(error)).not.toContain("cluster.local");
      });
    });
  });

  describe("given langevals sends an unset optional field as null", () => {
    /** @scenario "An evaluator result whose unset fields langevals sends as null is accepted as sent" */
    it("answers the processed result with its null fields as sent", async () => {
      answerWith([
        {
          status: "processed",
          score: 1.0,
          passed: true,
          label: null,
          details: "hello == hello",
          cost: null,
        },
      ]);

      await expect(httpService().evaluate(params)).resolves.toStrictEqual({
        status: "processed",
        score: 1,
        passed: true,
        label: null,
        details: "hello == hello",
        cost: null,
      });
    });

    /** @scenario "A skipped evaluator result whose unset fields langevals sends as null is accepted as sent" */
    it("answers the skipped result with its null cost as sent", async () => {
      answerWith([{ status: "skipped", details: "no expected output", cost: null }]);

      await expect(httpService().evaluate(params)).resolves.toStrictEqual({
        status: "skipped",
        details: "no expected output",
        cost: null,
      });
    });
  });

  describe("given langevals answers with something that is not an evaluation result", () => {
    /** @scenario "A langevals answer that is not an evaluation result fails the run naming the evaluator" */
    it("fails with an unexpected-response error carrying the validation issues", async () => {
      answerWith([{ status: "processed", score: "high" }]);

      const error = await evaluationFailure();

      expect(error.message).toBe("Unexpected response: invalid results");
      expect(error.meta).toEqual({ evaluatorType: "langevals/llm_boolean" });
      expect(error.reasons).toHaveLength(1);
    });
  });

  describe("given the caller aborts while langevals is still judging", () => {
    /** @scenario "a cancelled guardrail check aborts the evaluator's call to the analysis service" */
    it("aborts the request and does not retry", async () => {
      const fetchMock = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const service = LangevalsEvaluatorService.create({
        config: { endpoint: ENDPOINT, maxRetries: 2, timeoutMs: 60_000 },
        langevals: HttpLangevalsChannel.create({
          config: {
            stagingThresholdBytes: undefined,
            stagingTtlSeconds: 60,
            evaluationMaxPayloadBytes: 1_000_000,
            topicClusteringMaxPayloadBytes: 1_000_000,
          },
          staging: createApiFixture<LangevalsPayloadStaging>(),
        }),
      });
      const caller = new AbortController();

      const run = service
        .evaluate({ ...params, signal: caller.signal })
        .catch((error: unknown) => error);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      caller.abort();

      await expect(run).resolves.toBeInstanceOf(Error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a deployment without a langevals endpoint", () => {
    it("answers every evaluation as skipped", async () => {
      const service = LangevalsEvaluatorService.create({
        config: { endpoint: undefined, maxRetries: 0, timeoutMs: 10 },
        langevals: NullLangevalsChannel.create(),
      });

      await expect(service.evaluate(params)).resolves.toMatchObject({ status: "skipped" });
    });
  });
});
