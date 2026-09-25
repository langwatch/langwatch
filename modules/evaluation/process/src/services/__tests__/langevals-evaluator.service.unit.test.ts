import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 */
import { EvaluatorExecutionError } from "@langwatch/evaluation-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LangevalsEvaluateParams } from "../../app/evaluation.members.ts";
import { HttpLangevalsChannel } from "../../channels/http/http.langevals.channel.ts";
import type { LangevalsPayloadStaging } from "../../channels/langevals.channel.ts";
import { NullLangevalsChannel } from "../../channels/null.langevals.channel.ts";
import { LangevalsEvaluatorService } from "../langevals-evaluator.service.ts";

const ENDPOINT = "http://langevals.internal.langwatch.svc.cluster.local:5562";

const params: LangevalsEvaluateParams = {
  evaluatorType: "langevals/llm_boolean",
  data: { input: "hi", output: "there" },
  settings: {},
  env: {},
};

async function evaluationFailure(): Promise<EvaluatorExecutionError> {
  const service = LangevalsEvaluatorService.create({
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
  const thrown = await service.evaluate(params).catch((error: unknown) => error);
  if (!(thrown instanceof EvaluatorExecutionError)) {
    throw new Error("expected the evaluation to fail with EvaluatorExecutionError");
  }
  return thrown;
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
