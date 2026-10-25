/**
 * @vitest-environment node
 */
import { EvaluatorExecutionError } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpLangevalsChannel } from "../../../../channels/http/http.langevals.channel.ts";
import type { LangevalsPayloadStaging } from "../../../../channels/langevals.channel.ts";
import { NullLangevalsChannel } from "../../../../channels/null.langevals.channel.ts";
import { LangevalsEvaluatorService } from "../langevals-evaluator.service.ts";
import type { LangevalsEvaluateParams } from "../langevals-evaluator.service.ts";

const ENDPOINT = "http://langevals.internal.langwatch.svc.cluster.local:5562";

const params: LangevalsEvaluateParams = {
  projectId: "project_1",
  evaluatorType: "langevals/llm_boolean",
  data: { input: "hi", output: "there" },
  settings: {},
  env: {},
};

function httpService({ maxRetries = 0 }: { maxRetries?: number } = {}): LangevalsEvaluatorService {
  return LangevalsEvaluatorService.create({
    config: { endpoint: ENDPOINT, maxRetries, timeoutMs: 10 },
    langevals: HttpLangevalsChannel.create({
      config: {
        stagingThresholdBytes: undefined,
        stagingTtlSeconds: 60,
        evaluationMaxPayloadBytes: 1_000_000,
        topicClusteringMaxPayloadBytes: 1_000_000,
      },
    }),
    staging: createApiFixture<LangevalsPayloadStaging>(),
  });
}

async function evaluationFailure({ maxRetries = 0 }: { maxRetries?: number } = {}) {
  const thrown = await httpService({ maxRetries })
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

function answerStatus(status: number, body: string) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(body, { status })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function failFetchWith(error: Error) {
  const fetchMock = vi.fn(() => Promise.reject(error));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
          retryAfterMs: 5_000,
        });
        expect(JSON.stringify(error)).not.toContain("cluster.local");
      });
    });
  });

  describe("given the evaluator service is not up yet", () => {
    describe("when it cannot be reached", () => {
      /** @scenario "An evaluator called before the evaluator service is up is retried, not recorded as a failure" */
      it("fails retryable with 503 and the evaluator execution code", async () => {
        failFetchWith(new Error("fetch failed"));

        const error = await evaluationFailure();

        expect(error).toMatchObject({
          code: "evaluator_execution_error",
          httpStatus: 503,
          retryable: true,
          meta: { retryAfterMs: 5_000 },
        });
      });
    });

    describe("when it answers 503 while it starts", () => {
      /** @scenario "An evaluator called before the evaluator service is up is retried, not recorded as a failure" */
      it("fails retryable with 503, while another 5xx stays a recorded failure", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.resolve(new Response("starting", { status: 503 }))),
        );
        const starting = await evaluationFailure();
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.resolve(new Response("boom", { status: 500 }))),
        );
        const broken = await evaluationFailure();

        expect(starting).toMatchObject({
          code: "evaluator_execution_error",
          httpStatus: 503,
          retryable: true,
        });
        expect(broken).toMatchObject({ httpStatus: 502, retryable: false });
      });
    });
  });

  describe("given the evaluator service timed out", () => {
    describe("when the gateway in front of it answers 504", () => {
      /** @scenario "An evaluator service that timed out is recorded as an error and not called again" */
      it("calls it once and fails not retryable, saying the evaluator timed out", async () => {
        const fetchMock = answerStatus(504, "Endpoint request timed out");

        const error = await evaluationFailure({ maxRetries: 3 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(error).toMatchObject({
          code: "evaluator_execution_error",
          retryable: false,
          meta: { evaluatorType: "langevals/llm_boolean", httpStatus: 504 },
        });
        expect(error.message).toMatch(/^Evaluator timed out: 504/);
      });
    });

    describe("when our own call to it times out", () => {
      /** @scenario "An evaluator service that timed out is recorded as an error and not called again" */
      it("calls it once and fails not retryable, saying the evaluator timed out", async () => {
        const fetchMock = failFetchWith(
          Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
        );

        const error = await evaluationFailure({ maxRetries: 3 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(error).toMatchObject({ code: "evaluator_execution_error", retryable: false });
        expect(error.message).toBe("Evaluator timed out after 10ms");
      });
    });
  });

  describe("given the evaluator service is briefly unavailable", () => {
    describe("when it answers 503 because its queue is full", () => {
      /** @scenario "An evaluator service that is briefly unavailable is called again a bounded number of times" */
      it("calls it again up to the retry bound, then fails retryable for the queue", async () => {
        const fetchMock = answerStatus(503, "Evaluation queue is full");

        const error = await evaluationFailure({ maxRetries: 1 });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(error).toMatchObject({ httpStatus: 503, retryable: true });
      });
    });

    describe("when it answers 502 and then the result", () => {
      /** @scenario "An evaluator service that is briefly unavailable is called again a bounded number of times" */
      it("calls it again and answers the result", async () => {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
          .mockResolvedValueOnce(Response.json([{ status: "processed", score: 1, passed: true }]));
        vi.stubGlobal("fetch", fetchMock);

        const result = await httpService({ maxRetries: 1 }).evaluate(params);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ status: "processed", passed: true });
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

  describe("given a comparison evaluator run over its candidates", () => {
    /** @scenario "An evaluator's declared extra fields reach langevals as sent" */
    it("sends the declared candidates and row index, and drops an undeclared field", async () => {
      const fetchMock = vi.fn((_url: string, _init: { body: string }) =>
        Promise.resolve(Response.json([{ status: "processed", score: 1, label: "a" }])),
      );
      vi.stubGlobal("fetch", fetchMock);
      const candidates = [
        { id: "a", output: "first" },
        { id: "b", output: "second" },
      ];

      await httpService().evaluate({
        ...params,
        evaluatorType: "langevals/select_best_compare",
        data: { input: "q", candidates, row_index: 2, stray: "x" },
      });

      const [row] = JSON.parse(fetchMock.mock.calls[0]![1].body).data;
      expect(row).toMatchObject({ input: "q", candidates, row_index: 2 });
      expect(row).not.toHaveProperty("stray");
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
        }),
        staging: createApiFixture<LangevalsPayloadStaging>(),
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
        staging: createApiFixture<LangevalsPayloadStaging>(),
      });

      await expect(service.evaluate(params)).resolves.toMatchObject({ status: "skipped" });
    });
  });
});
