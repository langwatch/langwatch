/**
 * Shared setup for the Experiment.compare() unit suites, n-way judging of a
 * row's targets.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 *
 * The transport is stubbed, so what those suites assert is the contract the
 * SDK speaks: which keys reach the judge, which are deliberately absent so the
 * judge's own defaults apply, and the shape of what lands in the batch.
 */

import { afterEach, beforeEach, vi } from "vitest";
import { LangWatch } from "@/client-sdk";
import type { Experiment } from "../experiment";
import type { ComparisonOptions, ComparisonVerdict } from "../types";

export type JudgeCandidate = {
  id: string;
  output: string;
  duration?: number;
};

export type JudgeRequest = {
  trace_id: string | null;
  span_id: string | null;
  name: string;
  data: {
    input?: string;
    golden?: string;
    candidates: JudgeCandidate[];
    row_index?: number;
  };
  settings: Record<string, unknown>;
  as_guardrail: boolean;
};

export type JudgeResponse = {
  status: "processed" | "skipped" | "error";
  score?: number | null;
  label?: string | null;
  details?: string | null;
  cost?: { currency: string; amount: number } | null;
};

export type LoggedEvaluation = {
  name: string;
  evaluator: string;
  status: string;
  trace_id?: string | null;
  inputs?: { candidates?: { id: string }[] } | null;
  score?: number | null;
  label?: string | null;
  details?: string | null;
  /**
   * Numeric to match the wire contract: the server validates
   * `evaluations[].index` with `z.number()` and parses the batch before
   * dispatch, so a string here would be a payload it rejects outright.
   */
  index?: number | null;
  cost?: number | null;
  duration?: number | null;
  target_id?: string | null;
};

export const THREE_OUTPUTS: Record<string, unknown> = {
  "gpt-5-mini": "Four.",
  "claude-sonnet-5": "The answer is 4.",
  "gemini-flash": "4",
};

export const originalFetch = globalThis.fetch;

export const createHarness = () => {
  const judgeRequests: JudgeRequest[] = [];
  const loggedEvaluations: LoggedEvaluation[] = [];
  const loggedDatasetTargets: string[][] = [];
  const requestOrder: string[] = [];

  const harness = {
    judgeRequests,
    loggedEvaluations,
    loggedDatasetTargets,
    requestOrder,
    /** Held open to prove a comparison does not block the loop it runs in. */
    gate: null as Promise<void> | null,
    respond: (request: JudgeRequest): JudgeResponse => ({
      status: "processed",
      score: 1,
      label: request.data.candidates[0]!.id,
      details: "It answers the question directly.",
      cost: { currency: "USD", amount: 0.0004 },
    }),
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};

    if (url.includes("/api/experiment/init")) {
      return new Response(
        JSON.stringify({
          slug: "comparison-test",
          path: "/acme/experiments/comparison-test",
          id: "experiment-id",
        }),
        { status: 200 }
      );
    }

    if (url.includes("/evaluate")) {
      requestOrder.push("judge");
      judgeRequests.push(body as JudgeRequest);
      const response = harness.respond(body as JudgeRequest);
      if (harness.gate) await harness.gate;
      return new Response(JSON.stringify(response), { status: 200 });
    }

    if (url.includes("log_results")) {
      requestOrder.push("batch");
      loggedEvaluations.push(...((body.evaluations ?? []) as LoggedEvaluation[]));
      loggedDatasetTargets.push(
        ((body.dataset ?? []) as { target_id?: string | null }[])
          .map((entry) => entry.target_id)
          .filter((target): target is string => typeof target === "string")
      );
      return new Response(JSON.stringify({}), { status: 200 });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  return harness;
};

/**
 * Register the lifecycle every comparison suite needs: a fresh harness and
 * stubbed transport per test, a quiet console, and an environment left exactly
 * as it was found.
 *
 * The harness arrives through a callback rather than a return value because
 * the stubbed fetch closes over the instance it was built with. Handing back a
 * long-lived object and refilling it each test would leave that closure
 * pointing at the previous one, so a `respond` a test installed would never be
 * the one called.
 *
 * `LANGWATCH_API_KEY` is unset for the duration so `ensureSetup()` stays a
 * no-op and every suite passes its key explicitly, which is what keeps a real
 * key in the developer's environment from changing what a test exercises.
 */
export const useComparisonHarness = (
  assign: (harness: ComparisonHarness) => void,
): void => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;

  beforeEach(() => {
    delete process.env.LANGWATCH_API_KEY;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    assign(createHarness());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
  });
};

/** The stubbed transport and the recordings a suite asserts against. */
export type ComparisonHarness = ReturnType<typeof createHarness>;

export const createExperiment = (): Promise<Experiment> => {
  const langwatch = new LangWatch({
    apiKey: "sk-lw-test",
    endpoint: "http://localhost:5560",
  });
  return langwatch.experiments.init("comparison-test");
};

/**
 * Run one row: every target produces its output concurrently, the way a
 * customer writes it, and the comparison happens once they have all settled.
 */
export const runComparison = async (
  experiment: Experiment,
  {
    outputs = THREE_OUTPUTS,
    options = {},
  }: {
    outputs?: Record<string, unknown>;
    options?: Omit<Partial<ComparisonOptions>, "index">;
  } = {}
): Promise<{ verdict?: ComparisonVerdict; error?: unknown }> => {
  let verdict: ComparisonVerdict | undefined;
  let error: unknown;

  await experiment.run([{ question: "What is 2 + 2?" }], async ({ index }) => {
    await Promise.all(
      Object.entries(outputs).map(([target, output]) =>
        experiment.withTarget(target, () => output)
      )
    );

    try {
      verdict = await experiment.compare({ index, ...options });
    } catch (err) {
      error = err;
    }
  });

  return { verdict, error };
};

export const comparisonEvaluations = (harness: {
  loggedEvaluations: LoggedEvaluation[];
}): LoggedEvaluation[] =>
  harness.loggedEvaluations.filter(
    (evaluation) => evaluation.evaluator === "langevals/select_best_compare"
  );
