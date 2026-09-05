/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpLangevalsEvaluatorAdapter } from "../http.langevals-evaluator.adapter";

const ENDPOINT = "http://langevals.internal.langwatch.svc.cluster.local:5562";

function adapter() {
  return HttpLangevalsEvaluatorAdapter.create({
    config: { endpoint: ENDPOINT, maxRetries: 0, timeoutMs: 10 },
  });
}

const params = {
  evaluatorType: "langevals/llm_boolean",
  data: { input: "hi", output: "there" },
  settings: {},
  env: {},
} as Parameters<HttpLangevalsEvaluatorAdapter["evaluate"]>[0];

function failFetchWith(error: Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(error)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpLangevalsEvaluatorAdapter", () => {
  describe("given the evaluator service does not answer before the timeout", () => {
    describe("when the failure reaches the caller", () => {
      /** @scenario "An evaluator timeout names the evaluator, not the address dialled" */
      it("names the evaluator and the timeout, and not the address dialled", async () => {
        failFetchWith(
          Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
        );

        const error = await adapter()
          .evaluate(params)
          .catch((thrown: unknown) => thrown);

        expect(error).toMatchObject({
          meta: { evaluatorType: "langevals/llm_boolean", timeoutMs: 10 },
        });
        expect(JSON.stringify(error)).not.toContain("cluster.local");
        expect(JSON.stringify((error as { meta: unknown }).meta)).not.toContain("http");
      });
    });
  });

  describe("given the evaluator service cannot be reached", () => {
    describe("when the failure reaches the caller", () => {
      /** @scenario "An unreachable evaluator names the evaluator, not the address dialled" */
      it("names the evaluator and not the address dialled", async () => {
        failFetchWith(new Error("fetch failed"));

        const error = await adapter()
          .evaluate(params)
          .catch((thrown: unknown) => thrown);

        expect((error as { meta: Record<string, unknown> }).meta).toEqual({
          evaluatorType: "langevals/llm_boolean",
        });
        expect(JSON.stringify(error)).not.toContain("cluster.local");
      });
    });
  });
});
