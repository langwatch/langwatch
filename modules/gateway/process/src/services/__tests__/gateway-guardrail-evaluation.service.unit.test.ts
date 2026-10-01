/**
 * @vitest-environment node
 * Spec: specs/ai-gateway/guardrails.feature (latency budget, parallel guardrails)
 */
import type { EvaluationApi, GuardrailCheckInput } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayGuardrailRepository } from "../../repositories/gateway-guardrail.repository.ts";
import {
  GatewayGuardrailEvaluationService,
  REQUEST_GUARDRAIL_DEADLINE_MS,
} from "../gateway-guardrail-evaluation.service.ts";

const PROJECT_ID = "proj-1";
const failing: SingleEvaluationResult = {
  status: "processed",
  passed: false,
  details: "PII detected",
  cost: { amount: 0.01, currency: "USD" },
};
const passing: SingleEvaluationResult = {
  status: "processed",
  passed: true,
  cost: { amount: 0.02, currency: "USD" },
};

type Run = (input: GuardrailCheckInput) => Promise<SingleEvaluationResult>;

/** A run that only ends when its signal aborts, like a judge that honours cancellation. */
const hangsUntilAborted: Run = (input) =>
  new Promise((_resolve, reject) => {
    input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

function serviceWith({
  runs,
  failureMode = "FAIL_CLOSED",
}: {
  runs: Record<string, Run>;
  failureMode?: string;
}) {
  const names = Object.keys(runs);
  const signals: Record<string, AbortSignal | undefined> = {};
  const service = GatewayGuardrailEvaluationService.create({
    repository: createApiFixture<GatewayGuardrailRepository>({
      findRunnableForCheck: async () =>
        names.map((name) => ({ id: `gr-${name}`, name, evaluatorId: name, failureMode })),
    }),
    monitors: createApiFixture<MonitorApi>({
      listEnabledGuardrailMonitors: async () =>
        names.map((name) => ({
          id: `mon-${name}`,
          evaluatorId: name,
          checkType: name,
          parameters: {},
        })),
    }),
    evaluations: createApiFixture<EvaluationApi>({
      // Like evaluation's own check: "stopped" once the signal aborts, whatever the run does.
      checkGuardrail: async (input) => {
        signals[input.evaluatorType] = input.signal;
        const run = runs[input.evaluatorType];
        if (!run) throw new Error(`no run for ${input.evaluatorType}`);
        const stopped = new Promise<"stopped">((resolve) =>
          input.signal?.addEventListener("abort", () => resolve("stopped"), { once: true }),
        );
        const result = await Promise.race([run(input).catch(() => "stopped" as const), stopped]);

        return result === "stopped"
          ? { status: "stopped", by: "cancelled" }
          : { status: "evaluated", result };
      },
    }),
  });

  return { service, signals };
}

describe("GatewayGuardrailEvaluationService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a request-direction guardrail runs past the deadline", () => {
    /** @scenario "the control plane stops a request-direction check at its 800ms deadline" */
    it("answers by the deadline with a retryable unanswered check and aborts the evaluator", async () => {
      const { service, signals } = serviceWith({ runs: { slow: hangsUntilAborted } });

      const verdict = service.check({
        projectId: PROJECT_ID,
        guardrailIds: ["gr-slow"],
        direction: "request",
      });
      await vi.advanceTimersByTimeAsync(REQUEST_GUARDRAIL_DEADLINE_MS);

      await expect(verdict).resolves.toEqual({ status: "deadline_exceeded" });
      expect(signals.slow?.aborted).toBe(true);
    });

    /** @scenario "a fail-open guardrail allows when the deadline passes" */
    it("allows a fail-open guardrail even when its evaluator ignores the signal", async () => {
      const { service } = serviceWith({
        runs: { slow: () => new Promise<never>(() => undefined) },
        failureMode: "FAIL_OPEN",
      });

      const verdict = service.check({
        projectId: PROJECT_ID,
        guardrailIds: ["gr-slow"],
        direction: "request",
      });
      await vi.advanceTimersByTimeAsync(REQUEST_GUARDRAIL_DEADLINE_MS);

      await expect(verdict).resolves.toMatchObject({ verdict: { decision: "allow" } });
    });

    it("answers by the deadline even when the guardrail lookup hangs", async () => {
      const service = GatewayGuardrailEvaluationService.create({
        repository: createApiFixture<GatewayGuardrailRepository>({
          findRunnableForCheck: () => new Promise<never>(() => undefined),
        }),
        monitors: createApiFixture<MonitorApi>({}),
        evaluations: createApiFixture<EvaluationApi>({}),
      });

      const verdict = service.check({
        projectId: PROJECT_ID,
        guardrailIds: ["gr-slow"],
        direction: "request",
      });
      await vi.advanceTimersByTimeAsync(REQUEST_GUARDRAIL_DEADLINE_MS);

      await expect(verdict).resolves.toEqual({ status: "deadline_exceeded" });
    });
  });

  describe("when one of several guardrails blocks", () => {
    /** @scenario "a guardrail that blocks cancels the evaluators still running" */
    it("aborts the others and reports only the blocking policy", async () => {
      const { service, signals } = serviceWith({
        runs: { pii: async () => failing, judge: hangsUntilAborted },
      });

      const verdict = await service.check({
        projectId: PROJECT_ID,
        guardrailIds: ["gr-pii", "gr-judge"],
        direction: "response",
      });

      expect(verdict).toMatchObject({
        verdict: { decision: "block", policies_triggered: ["gr-pii"] },
      });
      expect(signals.judge?.aborted).toBe(true);
    });
  });

  describe("when the caller cancels the check", () => {
    /** @scenario "the caller's cancellation reaches the evaluator" */
    it("aborts the evaluator and fails closed", async () => {
      const { service, signals } = serviceWith({ runs: { judge: hangsUntilAborted } });
      const caller = new AbortController();

      const verdict = service.check({
        projectId: PROJECT_ID,
        guardrailIds: ["gr-judge"],
        direction: "response",
        signal: caller.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      caller.abort();

      await expect(verdict).resolves.toMatchObject({
        verdict: { decision: "block", reason: "guardrail check was cancelled" },
      });
      expect(signals.judge?.aborted).toBe(true);
    });
  });

  describe("when every guardrail passes", () => {
    it("allows", async () => {
      const { service } = serviceWith({
        runs: { a: async () => passing, b: async () => passing },
      });

      await expect(
        service.check({
          projectId: PROJECT_ID,
          guardrailIds: ["gr-a", "gr-b"],
          direction: "request",
        }),
      ).resolves.toMatchObject({ status: "evaluated", verdict: { decision: "allow" } });
    });
  });
});
