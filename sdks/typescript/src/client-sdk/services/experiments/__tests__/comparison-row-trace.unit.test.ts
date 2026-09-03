/**
 * Which trace a comparison is attributed to when rows are judged concurrently.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 *
 * A real tracer is installed here, unlike the sibling comparison suites: under
 * the no-op tracer every row reports the same all-zero trace, so a verdict
 * pinned to another row's trace would be indistinguishable from a correct one.
 */

import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComparisonError } from "../errors";
import {
  type ComparisonHarness,
  comparisonEvaluations,
  createExperiment,
  useComparisonHarness,
} from "./comparison-harness";

const CAPITALS = [
  { question: "What is the capital of the Netherlands?", answer: "Amsterdam" },
  { question: "What is the capital of Belgium?", answer: "Brussels" },
  { question: "What is the capital of France?", answer: "Paris" },
  { question: "What is the capital of Spain?", answer: "Madrid" },
];

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe("Experiment.compare", () => {
  let harness: ComparisonHarness;
  useComparisonHarness((created) => {
    harness = created;
  });

  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
  });

  /**
   * Every trace the run opened, against the row whose work opened it. Both the
   * iteration span and each target span carry the row they belong to, so a
   * trace id is enough to name the row a verdict was filed under.
   */
  const rowPerTrace = (): Map<string, number> => {
    const owners = new Map<string, number>();
    for (const span of exporter.getFinishedSpans()) {
      const row = span.attributes["evaluation.index"];
      if (typeof row === "number") {
        owners.set(span.spanContext().traceId, row);
      }
    }
    return owners;
  };

  type Mismatch = {
    source: string;
    row: number | null | undefined;
    tracedToRow: number | string;
  };

  /**
   * How many of these entries name a trace, and which of those name a row
   * other than their own. An entry with no trace id is evidence of nothing,
   * so it is counted out rather than passed silently: the count is what makes
   * "no mismatches" mean something, since a run that attributed nothing would
   * otherwise read the same as a run that attributed everything correctly.
   */
  const attribution = (
    owners: Map<string, number>,
    source: string,
    entries: { row: number | null | undefined; traceId: string | null | undefined }[],
  ): { traced: number; mismatched: Mismatch[] } => {
    const traced = entries.filter((entry) => entry.traceId);

    return {
      traced: traced.length,
      mismatched: traced
        .filter((entry) => owners.get(entry.traceId!) !== entry.row)
        .map((entry) => ({
          source,
          row: entry.row,
          tracedToRow:
            owners.get(entry.traceId ?? "") ?? "a trace no row of this run opened",
        })),
    };
  };

  describe("given rows compared while an earlier row is still being processed", () => {
    describe("when every row compares its own targets", () => {
      /** @scenario "A concurrent run keeps every verdict on its own row" */
      it("keeps each row's comparison on its own row's trace", async () => {
        const experiment = await createExperiment();

        // Only the first row opens a row-level trace: the iteration that runs
        // before any withTarget() call is the one that gets an iteration span.
        // Holding it open here is what puts the later rows' comparisons inside
        // its lifetime, which is the window the race needs.
        const laterRowsCompared = deferred();
        let comparedAfterFirstRow = 0;

        await experiment.run(
          CAPITALS,
          async ({ item, index }) => {
            await Promise.all([
              experiment.withTarget("gpt-5-mini", () => `${item.answer}.`),
              experiment.withTarget(
                "claude-sonnet-5",
                () => `The answer is ${item.answer}.`,
              ),
            ]);

            if (index === 0) await laterRowsCompared.promise;

            await experiment.compare({ input: item.question });

            if (index > 0 && ++comparedAfterFirstRow === CAPITALS.length - 1) {
              laterRowsCompared.resolve();
            }
          },
          { concurrency: CAPITALS.length },
        );

        const owners = rowPerTrace();
        const recorded = comparisonEvaluations(harness);

        expect(harness.judgeRequests).toHaveLength(CAPITALS.length);
        expect(recorded).toHaveLength(CAPITALS.length);

        const judged = attribution(
          owners,
          "judge request",
          harness.judgeRequests.map((request) => ({
            row: request.data.row_index,
            traceId: request.trace_id,
          })),
        );
        const filed = attribution(
          owners,
          "recorded evaluation",
          recorded.map((evaluation) => ({
            row: evaluation.index,
            traceId: evaluation.trace_id,
          })),
        );

        // One traced comparison per side, not four. Only the row that runs
        // before any withTarget() call gets an iteration span, because the
        // switch to target-rooted traces is a run-wide latch, so the other
        // rows compare with no row-level trace to be attributed to. Asserting
        // the count is what keeps "no mismatches" meaningful: blanking every
        // trace id would leave nothing to mismatch. Give every row its own
        // trace and this number becomes CAPITALS.length, which is a change to
        // make here deliberately rather than discover as a passing test.
        expect({
          mismatched: [...judged.mismatched, ...filed.mismatched],
          tracedJudged: judged.traced,
          tracedRecorded: filed.traced,
        }).toEqual({ mismatched: [], tracedJudged: 1, tracedRecorded: 1 });
      });

      /**
       * The check above proves no verdict was filed under a neighbour's row.
       * This one proves the trace a verdict does carry is the row's own
       * iteration trace, and not some other trace the run happened to open.
       */
      it("keeps the trace of the row that has one", async () => {
        const experiment = await createExperiment();

        await experiment.run(
          CAPITALS.slice(0, 1),
          async ({ item }) => {
            await Promise.all([
              experiment.withTarget("gpt-5-mini", () => `${item.answer}.`),
              experiment.withTarget(
                "claude-sonnet-5",
                () => `The answer is ${item.answer}.`,
              ),
            ]);

            await experiment.compare({ input: item.question });
          },
          { concurrency: 1 },
        );

        const iterationTraceId = exporter
          .getFinishedSpans()
          .find((span) => span.name === "evaluation.iteration")
          ?.spanContext().traceId;

        expect(iterationTraceId).toBeDefined();
        expect(harness.judgeRequests[0]!.trace_id).toBe(iterationTraceId);
        expect(comparisonEvaluations(harness)[0]!.trace_id).toBe(iterationTraceId);
      });
    });

    describe("when a comparison arrives from outside any iteration", () => {
      it("asks which row rather than judging the one a neighbour is on", async () => {
        const experiment = await createExperiment();

        // Rooted before the run, so no iteration's context reaches it: a
        // background caller comparing while rows are in flight.
        const rowsInFlight = deferred();
        const comparedFromOutside = rowsInFlight.promise.then(() =>
          experiment.compare().catch((error: unknown) => error),
        );

        // Every other row stays open until that caller has its answer, so a
        // row it could be misread as is always in flight when it runs.
        const rowsMayFinish = deferred();
        let outcome: unknown;

        await experiment.run(
          CAPITALS,
          async ({ item, index }) => {
            await Promise.all([
              experiment.withTarget("gpt-5-mini", () => `${item.answer}.`),
              experiment.withTarget(
                "claude-sonnet-5",
                () => `The answer is ${item.answer}.`,
              ),
            ]);

            if (index === 1) {
              rowsInFlight.resolve();
              outcome = await comparedFromOutside;
              rowsMayFinish.resolve();
            } else {
              await rowsMayFinish.promise;
            }

            await experiment.compare({ input: item.question });
          },
          { concurrency: CAPITALS.length },
        );

        expect(outcome).toBeInstanceOf(ComparisonError);
        expect(harness.judgeRequests).toHaveLength(CAPITALS.length);
      });
    });
  });
});
