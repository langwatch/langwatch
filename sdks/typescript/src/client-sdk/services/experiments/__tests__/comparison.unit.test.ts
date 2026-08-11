/**
 * Unit tests for Experiment.compare(), n-way judging of a row's targets.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 *
 * The transport is stubbed, so what these assert is the contract the SDK
 * speaks: which keys reach the judge, which are deliberately absent so the
 * judge's own defaults apply, and the shape of what lands in the batch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LangWatch } from "@/client-sdk";
import { ComparisonError } from "../errors";
import type { Experiment } from "../experiment";
import type {
  ComparisonMetric,
  ComparisonOptions,
  ComparisonVerdict,
} from "../types";

type JudgeCandidate = {
  id: string;
  output: string;
  duration?: number;
};

type JudgeRequest = {
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

type JudgeResponse = {
  status: "processed" | "skipped" | "error";
  score?: number | null;
  label?: string | null;
  details?: string | null;
  cost?: { currency: string; amount: number } | null;
};

type LoggedEvaluation = {
  name: string;
  evaluator: string;
  status: string;
  inputs?: { candidates?: { id: string }[] } | null;
  score?: number | null;
  label?: string | null;
  details?: string | null;
  index?: number | string | null;
  cost?: number | null;
  duration?: number | null;
  target_id?: string | null;
};

const THREE_OUTPUTS: Record<string, unknown> = {
  "gpt-5-mini": "Four.",
  "claude-sonnet-5": "The answer is 4.",
  "gemini-flash": "4",
};

const originalFetch = globalThis.fetch;

const createHarness = () => {
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

const createExperiment = (): Promise<Experiment> => {
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
const runComparison = async (
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

const comparisonEvaluations = (harness: {
  loggedEvaluations: LoggedEvaluation[];
}): LoggedEvaluation[] =>
  harness.loggedEvaluations.filter(
    (evaluation) => evaluation.evaluator === "langevals/select_best_compare"
  );

describe("Experiment.compare", () => {
  let harness: ReturnType<typeof createHarness>;
  const previousApiKey = process.env.LANGWATCH_API_KEY;

  beforeEach(() => {
    // Left unset so ensureSetup() stays a no-op; the key is passed explicitly.
    delete process.env.LANGWATCH_API_KEY;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    harness = createHarness();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
  });

  describe("given three targets recorded an output for the row", () => {
    describe("when the row is compared with no options beyond the row", () => {
      /** @scenario "Comparing every target on a row takes one call" */
      it("judges all three outputs in a single call the caller configured nothing for", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment);

        expect(harness.judgeRequests).toHaveLength(1);
        const request = harness.judgeRequests[0]!;
        expect(request.data.candidates.map((candidate) => candidate.id)).toEqual([
          "gpt-5-mini",
          "claude-sonnet-5",
          "gemini-flash",
        ]);
        expect(request.settings).toEqual({});
        expect(verdict?.candidates).toEqual([
          "gpt-5-mini",
          "claude-sonnet-5",
          "gemini-flash",
        ]);
      });

      it("judges outputs the batch already sent and cleared", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        // The batch is flushed on a timer, so by the time a row is compared
        // its target outputs can already be gone from it. They are judged
        // anyway, which is only possible because they are held elsewhere.
        const flushedBeforeJudging = harness.requestOrder.indexOf("batch");
        expect(flushedBeforeJudging).toBeGreaterThanOrEqual(0);
        expect(flushedBeforeJudging).toBeLessThan(
          harness.requestOrder.indexOf("judge")
        );
        expect(harness.loggedDatasetTargets.flat()).toEqual(
          expect.arrayContaining(Object.keys(THREE_OUTPUTS))
        );
        expect(
          harness.judgeRequests[0]!.data.candidates.map((candidate) => candidate.id)
        ).toEqual(Object.keys(THREE_OUTPUTS));
      });

      /** @scenario "The verdict belongs to the row, not to a target" */
      it("records one row-level verdict carrying no target", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        const recorded = comparisonEvaluations(harness);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
          name: "comparison",
          evaluator: "langevals/select_best_compare",
          status: "processed",
          index: 0,
          target_id: null,
        });
        expect(recorded[0]!.inputs?.candidates).toEqual([
          { id: "gpt-5-mini" },
          { id: "claude-sonnet-5" },
          { id: "gemini-flash" },
        ]);
      });

      it("keeps the verdict off the row's targets even when compared from inside a target block", async () => {
        const experiment = await createExperiment();

        await experiment.run([{ question: "What is 2 + 2?" }], async ({ index }) => {
          await Promise.all(
            Object.entries(THREE_OUTPUTS).map(([target, output]) =>
              experiment.withTarget(target, () => output)
            )
          );
          await experiment.withTarget("verdict-wrapper", async () => {
            await experiment.compare({ index });
            return null;
          });
        });

        const recorded = comparisonEvaluations(harness);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.target_id).toBeNull();
      });

      /** @scenario "Judging on merits is the default" */
      it("sends no reference answer and does not turn golden judging on", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        const request = harness.judgeRequests[0]!;
        expect("golden" in request.data).toBe(false);
        expect("has_golden_answer" in request.settings).toBe(false);
      });

      /** @scenario "The SDK does not ship its own copy of the judge prompt" */
      it("sends no prompt so the judge picks the default that fits the row", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        expect("prompt" in harness.judgeRequests[0]!.settings).toBe(false);
      });

      /** @scenario "Unset options are not sent" */
      it("omits every setting the caller did not set", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        expect(Object.keys(harness.judgeRequests[0]!.settings)).toEqual([]);
      });

      /** @scenario "Both SDKs expose the same comparison" */
      it("maps every option onto the judge's own setting names and returns the shared verdict shape", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment, {
          options: {
            name: "head-to-head",
            input: "What is 2 + 2?",
            golden: "4",
            prompt: "Pick the best of {candidates}",
            model: "openai/gpt-5-mini",
            allowTie: false,
            randomizeOrder: false,
            swapAndReconcile: false,
            includeMetrics: ["duration"],
            temperature: 0.2,
          },
        });

        const request = harness.judgeRequests[0]!;
        expect(request.name).toBe("head-to-head");
        expect(request.settings).toEqual({
          prompt: "Pick the best of {candidates}",
          model: "openai/gpt-5-mini",
          has_golden_answer: true,
          allow_tie: false,
          randomize_order: false,
          swap_and_reconcile: false,
          include_metrics: ["duration"],
          temperature: 0.2,
        });
        expect(Object.keys(request.data).sort()).toEqual([
          "candidates",
          "golden",
          "input",
          "row_index",
        ]);
        expect(Object.keys(verdict!).sort()).toEqual([
          "candidates",
          "reasoning",
          "status",
          "winner",
        ]);
      });
    });

    describe("when the row is compared asking for per-candidate metrics", () => {
      /** @scenario "Duration is the only per-candidate metric on offer" */
      it("shows the judge how long each candidate took, and never a cost", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, {
          options: { includeMetrics: ["duration"] },
        });

        const request = harness.judgeRequests[0]!;
        expect(request.settings.include_metrics).toEqual(["duration"]);
        for (const candidate of request.data.candidates) {
          expect(typeof candidate.duration).toBe("number");
          expect(candidate.duration).toBeGreaterThanOrEqual(0);
          expect("cost" in candidate).toBe(false);
        }

        // The option cannot ask for one either, so nothing can request a
        // metric the SDK has no value to fill.
        // @ts-expect-error cost is not a comparison metric
        const unsupported: ComparisonMetric[] = ["cost"];
        expect(unsupported).toEqual(["cost"]);
      });
    });

    describe("when the row is compared with a reference answer", () => {
      /** @scenario "Giving a reference answer turns on golden judging" */
      it("sends the reference answer and turns golden judging on from that one option", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, { options: { golden: "4" } });

        const request = harness.judgeRequests[0]!;
        expect(request.data.golden).toBe("4");
        expect(request.settings.has_golden_answer).toBe(true);
      });
    });

    describe("when the row is compared with a custom judge prompt", () => {
      /** @scenario "The judge prompt can be customized" */
      it("sends that prompt verbatim", async () => {
        const experiment = await createExperiment();
        const prompt = "Rank {candidates} by how well they cite {input}.";

        await runComparison(experiment, { options: { prompt } });

        expect(harness.judgeRequests[0]!.settings.prompt).toBe(prompt);
      });
    });

    describe("when the row is compared with ties disallowed", () => {
      /** @scenario "Options I do set are sent" */
      it("disallows ties in the request", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, { options: { allowTie: false } });

        expect(harness.judgeRequests[0]!.settings.allow_tie).toBe(false);
      });
    });

    describe("when the judge picks a winner", () => {
      /** @scenario "The verdict names the winning target" */
      it("names the winner with the registered target name and carries the reasoning", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "processed",
          score: 1,
          label: "claude-sonnet-5",
          details: "It shows the working, the others only state the result.",
        });

        const { verdict } = await runComparison(experiment);

        expect(verdict).toEqual({
          status: "decided",
          winner: "claude-sonnet-5",
          reasoning: "It shows the working, the others only state the result.",
          candidates: ["gpt-5-mini", "claude-sonnet-5", "gemini-flash"],
        });
        expect(comparisonEvaluations(harness)[0]!.label).toBe("claude-sonnet-5");
      });
    });

    describe("when the judge finds no candidate clearly better", () => {
      /** @scenario "The judge may return a tie" */
      it("reports a tie with no winner", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "processed",
          score: 0.5,
          label: "tie",
          details: "All three answer correctly and at the same length.",
        });

        const { verdict } = await runComparison(experiment);

        expect(verdict?.status).toBe("tie");
        expect(verdict?.winner).toBeNull();
        expect(comparisonEvaluations(harness)[0]).toMatchObject({
          status: "processed",
          label: "tie",
        });
      });
    });

    describe("when the two swap-and-reconcile passes disagree", () => {
      /** @scenario "A verdict that flips under order swap is inconclusive" */
      it("reports the row as inconclusive rather than as a tie", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "skipped",
          details:
            "Order-sensitive verdict: original order picked gpt-5-mini; reversed order picked gemini-flash.",
        });

        const { verdict } = await runComparison(experiment);

        expect(verdict?.status).toBe("inconclusive");
        expect(verdict?.winner).toBeNull();
        expect(verdict?.reasoning).toContain("Order-sensitive verdict");

        const recorded = comparisonEvaluations(harness)[0]!;
        expect(recorded.status).toBe("skipped");
        expect(recorded.label).not.toBe("tie");
        expect(recorded.label).toBeNull();
      });
    });

    describe("when only two of the three targets are named", () => {
      /** @scenario "Comparing a subset of the registered targets" */
      it("judges exactly the two named", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment, {
          options: { targets: ["gpt-5-mini", "claude-sonnet-5"] },
        });

        expect(
          harness.judgeRequests[0]!.data.candidates.map((candidate) => candidate.id)
        ).toEqual(["gpt-5-mini", "claude-sonnet-5"]);
        expect(verdict?.candidates).toEqual(["gpt-5-mini", "claude-sonnet-5"]);
      });
    });

    describe("when the same row is compared twice", () => {
      /** @scenario "Candidate order is seeded from the row automatically" */
      it("seeds both calls from the row index, and a different row with a different one", async () => {
        const experiment = await createExperiment();

        await experiment.run(
          [{ question: "What is 2 + 2?" }, { question: "What is 3 + 3?" }],
          async ({ index }) => {
            await Promise.all(
              Object.entries(THREE_OUTPUTS).map(([target, output]) =>
                experiment.withTarget(target, () => output)
              )
            );
            await experiment.compare({ index });
            if (index === 0) await experiment.compare({ index });
          },
          { concurrency: 1 }
        );

        const [first, second, other] = harness.judgeRequests;
        expect(first!.data.row_index).toBe(0);
        expect(second!.data.row_index).toBe(0);
        expect(first!.data.candidates.map((candidate) => candidate.id)).toEqual(
          second!.data.candidates.map((candidate) => candidate.id)
        );
        expect(other!.data.row_index).toBe(1);
      });
    });
  });

  describe("given a run over several rows, each with its own answer", () => {
    const CITIES = [
      { answer: "Amsterdam" },
      { answer: "Rotterdam" },
      { answer: "Utrecht" },
    ];

    /** Both targets answer with the row's own city, so a verdict about the
     * wrong row is visible in the candidates the judge was shown. */
    const answerEachRow = (experiment: Experiment, item: { answer: string }) =>
      Promise.all([
        experiment.withTarget("gpt-5-mini", () => `${item.answer}.`),
        experiment.withTarget(
          "claude-sonnet-5",
          () => `The answer is ${item.answer}.`
        ),
      ]);

    describe("when a row is compared without naming it", () => {
      /** @scenario "The row being iterated is the row compared" */
      it("compares the row the iteration is on, one verdict per row", async () => {
        const experiment = await createExperiment();

        await experiment.run(
          CITIES,
          async ({ item }) => {
            await answerEachRow(experiment, item);
            await experiment.compare();
          },
          { concurrency: 3 }
        );

        expect(harness.judgeRequests).toHaveLength(3);
        expect(
          harness.judgeRequests.map((request) => request.data.row_index).sort()
        ).toEqual([0, 1, 2]);
        for (const request of harness.judgeRequests) {
          const city = CITIES[request.data.row_index!]!.answer;
          for (const candidate of request.data.candidates) {
            expect(candidate.output).toContain(city);
          }
        }
      });
    });

    describe("when a row is compared naming a different one", () => {
      /** @scenario "A row named explicitly is the row compared" */
      it("compares the row named, not the one being iterated", async () => {
        const experiment = await createExperiment();

        await experiment.run(
          CITIES,
          async ({ item, index }) => {
            await answerEachRow(experiment, item);
            if (index === 2) await experiment.compare({ index: 0 });
          },
          { concurrency: 1 }
        );

        expect(harness.judgeRequests).toHaveLength(1);
        const request = harness.judgeRequests[0]!;
        expect(request.data.row_index).toBe(0);
        for (const candidate of request.data.candidates) {
          expect(candidate.output).toContain("Amsterdam");
        }
        expect(comparisonEvaluations(harness)[0]!.index).toBe(0);
      });
    });
  });

  describe("given targets that ran outside any iteration", () => {
    describe("when the row is compared without naming it", () => {
      /** @scenario "Comparing outside an iteration asks which row" */
      it("asks for the row instead of judging whichever one it could reach", async () => {
        const experiment = await createExperiment();
        await experiment.withTarget("gpt-5-mini", () => "Amsterdam.");
        await experiment.withTarget(
          "claude-sonnet-5",
          () => "The answer is Amsterdam."
        );

        const error = await experiment.compare().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ComparisonError);
        expect((error as ComparisonError).message).toContain(
          "Pass index explicitly"
        );
        expect((error as ComparisonError).message).toContain("run()");
        expect(harness.judgeRequests).toHaveLength(0);
      });

      it("judges the row once it is named", async () => {
        const experiment = await createExperiment();
        await experiment.withTarget("gpt-5-mini", () => "Amsterdam.");
        await experiment.withTarget(
          "claude-sonnet-5",
          () => "The answer is Amsterdam."
        );

        const verdict = await experiment.compare({ index: 0 });

        expect(verdict.status).toBe("decided");
        expect(harness.judgeRequests[0]!.data.row_index).toBe(0);
      });
    });
  });

  describe("given one of the three targets recorded no output for the row", () => {
    const TWO_OUTPUTS = { ...THREE_OUTPUTS, "gemini-flash": null };

    describe("when the row is compared", () => {
      /** @scenario "Only targets with an output become candidates" */
      it("judges only the targets that produced something", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment, {
          outputs: TWO_OUTPUTS,
        });

        expect(
          harness.judgeRequests[0]!.data.candidates.map((candidate) => candidate.id)
        ).toEqual(["gpt-5-mini", "claude-sonnet-5"]);
        expect(verdict?.candidates).toEqual(["gpt-5-mini", "claude-sonnet-5"]);
      });
    });

    describe("when the row is compared naming that target", () => {
      /** @scenario "Naming a target that produced no output is an error" */
      it("fails with an error naming it, without calling the judge", async () => {
        const experiment = await createExperiment();

        const { error, verdict } = await runComparison(experiment, {
          outputs: TWO_OUTPUTS,
          options: {
            targets: ["gpt-5-mini", "claude-sonnet-5", "gemini-flash"],
          },
        });

        expect(error).toBeInstanceOf(ComparisonError);
        expect((error as ComparisonError).message).toContain("gemini-flash");
        expect((error as ComparisonError).missingTargets).toEqual(["gemini-flash"]);
        expect(verdict).toBeUndefined();
        expect(harness.judgeRequests).toHaveLength(0);
      });
    });
  });

  describe("given only one target recorded an output for the row", () => {
    const ONE_OUTPUT = {
      ...THREE_OUTPUTS,
      "claude-sonnet-5": null,
      "gemini-flash": "",
    };

    describe("when the row is compared", () => {
      /** @scenario "A row with fewer than two outputs is skipped, not failed" */
      it("skips the row, names what was missing, and lets the run finish", async () => {
        const experiment = await createExperiment();

        const { verdict, error } = await runComparison(experiment, {
          outputs: ONE_OUTPUT,
        });

        expect(error).toBeUndefined();
        expect(harness.judgeRequests).toHaveLength(0);
        expect(verdict?.status).toBe("skipped");
        expect(verdict?.winner).toBeNull();
        expect(verdict?.candidates).toEqual(["gpt-5-mini"]);
        expect(verdict?.reasoning).toContain("at least two candidate outputs");
        expect(verdict?.reasoning).toContain("claude-sonnet-5");
        expect(verdict?.reasoning).toContain("gemini-flash");

        const recorded = comparisonEvaluations(harness);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
          status: "skipped",
          label: null,
          score: null,
          target_id: null,
        });
      });
    });
  });

  describe("given a target returned its response wrapped in an output field", () => {
    describe("when the row is compared", () => {
      it("shows the judge the same text as the target that returned the response itself", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, {
          outputs: {
            "gpt-5-mini": "Four.",
            "claude-sonnet-5": { output: "Four." },
            "gemini-flash": { answer: "Four.", confidence: 0.9 },
          },
        });

        expect(
          harness.judgeRequests[0]!.data.candidates.map(
            (candidate) => candidate.output
          )
        ).toEqual(["Four.", "Four.", '{"answer":"Four.","confidence":0.9}']);
      });
    });
  });

  describe("given the judge cannot be reached", () => {
    describe("when the row is compared", () => {
      it("reports an error verdict, records the row as errored, and lets the run finish", async () => {
        const experiment = await createExperiment();
        harness.respond = () => {
          throw new Error("judge unreachable");
        };

        const { verdict, error } = await runComparison(experiment);

        expect(error).toBeUndefined();
        expect(verdict?.status).toBe("error");
        expect(verdict?.winner).toBeNull();
        expect(verdict?.reasoning).toContain("judge unreachable");
        expect(comparisonEvaluations(harness)[0]).toMatchObject({
          status: "error",
          label: null,
          score: null,
        });
      });

      it("keeps a failed judge call distinct from a judge that reached no verdict", async () => {
        const experiment = await createExperiment();
        harness.respond = () => {
          throw new Error("judge unreachable");
        };
        const { verdict: failed } = await runComparison(experiment);

        const second = await createExperiment();
        harness.respond = () => ({
          status: "skipped",
          details: "Order-sensitive verdict.",
        });
        const { verdict: undecided } = await runComparison(second);

        expect(failed?.status).toBe("error");
        expect(undecided?.status).toBe("inconclusive");
      });
    });
  });

  describe("given the judge itself reports a failure", () => {
    describe("when the row is compared", () => {
      it("reports an error verdict carrying the judge's own message", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "error",
          details: "The judge model is not configured for this project.",
        });

        const { verdict, error } = await runComparison(experiment);

        expect(error).toBeUndefined();
        expect(verdict?.status).toBe("error");
        expect(verdict?.reasoning).toBe(
          "The judge model is not configured for this project."
        );
        expect(comparisonEvaluations(harness)[0]!.status).toBe("error");
      });
    });
  });

  describe("given every kind of outcome a row can reach", () => {
    describe("when each is compared", () => {
      it("records a batch status that agrees with the verdict it returns", async () => {
        const cases: {
          respond: () => JudgeResponse;
          outputs?: Record<string, unknown>;
          status: string;
          entryStatus: string;
        }[] = [
          {
            respond: () => ({ status: "processed", score: 1, label: "gpt-5-mini" }),
            status: "decided",
            entryStatus: "processed",
          },
          {
            respond: () => ({ status: "processed", score: 0.5, label: "tie" }),
            status: "tie",
            entryStatus: "processed",
          },
          {
            respond: () => ({ status: "skipped", details: "No stable answer." }),
            status: "inconclusive",
            entryStatus: "skipped",
          },
          {
            respond: () => ({ status: "error", details: "Judge exploded." }),
            status: "error",
            entryStatus: "error",
          },
          {
            respond: () => ({ status: "processed", score: 1, label: "gpt-5-mini" }),
            outputs: { ...THREE_OUTPUTS, "claude-sonnet-5": null, "gemini-flash": null },
            status: "skipped",
            entryStatus: "skipped",
          },
        ];

        for (const testCase of cases) {
          harness.loggedEvaluations.length = 0;
          harness.respond = testCase.respond;
          const experiment = await createExperiment();

          const { verdict } = await runComparison(experiment, {
            outputs: testCase.outputs,
          });

          expect(verdict?.status).toBe(testCase.status);
          expect(comparisonEvaluations(harness)[0]!.status).toBe(
            testCase.entryStatus
          );
        }
      });
    });
  });

  describe("given an experiment iterating rows concurrently", () => {
    describe("when each row awaits its own comparison", () => {
      /** @scenario "Comparing from an async experiment" */
      it("keeps the other rows moving while a judge is thinking, and records each row the same way", async () => {
        const experiment = await createExperiment();
        let release!: () => void;
        harness.gate = new Promise<void>((resolve) => {
          release = resolve;
        });

        const running = experiment.run(
          [{ question: "What is 2 + 2?" }, { question: "What is 3 + 3?" }],
          async ({ index }) => {
            await Promise.all(
              Object.entries(THREE_OUTPUTS).map(([target, output]) =>
                experiment.withTarget(target, () => output)
              )
            );
            await experiment.compare({ index });
          },
          { concurrency: 2 }
        );

        // Both rows reach the judge before either verdict comes back, which
        // they could not do if awaiting one comparison held the loop.
        await vi.waitFor(() => expect(harness.judgeRequests).toHaveLength(2));
        release();
        await running;

        const recorded = comparisonEvaluations(harness);
        expect(recorded.map((evaluation) => evaluation.index).sort()).toEqual([0, 1]);
        for (const evaluation of recorded) {
          expect(evaluation).toMatchObject({
            evaluator: "langevals/select_best_compare",
            name: "comparison",
            status: "processed",
            target_id: null,
          });
          expect(evaluation.inputs?.candidates).toEqual([
            { id: "gpt-5-mini" },
            { id: "claude-sonnet-5" },
            { id: "gemini-flash" },
          ]);
        }
      });
    });
  });
});
