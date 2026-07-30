import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import type { ReportEvaluationCommandData } from "../../../evaluation-processing/schemas/commands";
import {
  type CustomEvaluationSyncDispatchDeps,
  createCustomEvaluationReportHandler,
  type StoredSpanEvent,
} from "../customEvaluationSyncIntentHandlers";
import {
  CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
  CUSTOM_EVALUATION_SPAN_EVENT_NAME,
  type CustomEvaluationReportIntent,
} from "../customEvaluationSyncProcess.types";

const TRACE_ID = "trace-1";
const SPAN_ID = "bbbb000000000001";
const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;
const SPAN_STARTED_AT = NOW - 1_000;

const CTX: IntentContext = {
  processName: "customEvaluationSync",
  projectId: PROJECT_ID,
  processKey: TRACE_ID,
  tenantId: PROJECT_ID,
  messageKey: `process:${TRACE_ID}:custom-eval:${TRACE_ID}:${SPAN_ID}`,
  attempt: 1,
};

function intent(
  overrides: Partial<CustomEvaluationReportIntent> = {},
): CustomEvaluationReportIntent {
  return {
    tenantId: PROJECT_ID,
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    occurredAt: NOW,
    spanStartedAt: SPAN_STARTED_AT,
    ...overrides,
  };
}

/** One stored span event, in the shape the span store's read path returns. */
function storedEvaluation(payload: unknown): StoredSpanEvent {
  return {
    event_type: CUSTOM_EVALUATION_SPAN_EVENT_NAME,
    event_details: [
      {
        key: CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
        value: typeof payload === "string" ? payload : JSON.stringify(payload),
      },
    ],
  };
}

function makeDeps(
  overrides: {
    spanEvents?: StoredSpanEvent[];
    getSpanEvents?: CustomEvaluationSyncDispatchDeps["getSpanEvents"];
    reportEvaluation?: CustomEvaluationSyncDispatchDeps["reportEvaluation"];
  } = {},
) {
  const spanEvents = overrides.spanEvents ?? [
    storedEvaluation({ name: "toxicity" }),
  ];
  const getSpanEvents = vi.fn(
    overrides.getSpanEvents ?? (async () => spanEvents),
  );
  const reportEvaluation = vi.fn(
    overrides.reportEvaluation ?? (async () => undefined),
  );

  return {
    deps: {
      getSpanEvents,
      reportEvaluation,
    } satisfies CustomEvaluationSyncDispatchDeps,
    getSpanEvents,
    reportEvaluation,
  };
}

function reported(
  reportEvaluation: ReturnType<typeof makeDeps>["reportEvaluation"],
  index = 0,
): ReportEvaluationCommandData {
  const [data] = reportEvaluation.mock.calls[index] as [
    ReportEvaluationCommandData,
  ];
  return data;
}

describe("customEvaluationSync reportEvaluations intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a span whose SDK ran its own evaluations", () => {
    it("resolves the claim-check against the span store", async () => {
      const { deps, getSpanEvents } = makeDeps();

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      // Windowed on the span's own start: the store read has no unbounded
      // fallback, so an ingest-centered window is permanently blind to a span
      // that ran long and exported on end.
      expect(getSpanEvents).toHaveBeenCalledWith({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        occurredAtMs: SPAN_STARTED_AT,
      });
    });

    it("records one evaluation per verdict", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({ name: "toxicity" }),
          storedEvaluation({ name: "relevance" }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reportEvaluation).toHaveBeenCalledTimes(2);
    });

    it("records it against the trace the span belongs to", async () => {
      const { deps, reportEvaluation } = makeDeps();

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation)).toMatchObject({
        tenantId: PROJECT_ID,
        traceId: TRACE_ID,
        evaluatorType: "custom",
        evaluatorName: "toxicity",
      });
    });

    it("carries the verdict the SDK reached", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({
            name: "toxicity",
            score: 0.1,
            passed: true,
            label: "safe",
            details: "No toxic content found",
            status: "processed",
            cost_id: "cost-1",
          }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation)).toMatchObject({
        score: 0.1,
        passed: true,
        label: "safe",
        details: "No toxic content found",
        status: "processed",
        costId: "cost-1",
      });
    });

    it("stamps the instant the span happened", async () => {
      const { deps, reportEvaluation } = makeDeps();

      await createCustomEvaluationReportHandler(deps)(
        intent({ occurredAt: NOW - 4_000 }),
        CTX,
      );

      expect(reported(reportEvaluation).occurredAt).toBe(NOW - 4_000);
    });

    it("reads a verdict the SDK left open as processed", async () => {
      const { deps, reportEvaluation } = makeDeps();

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation).status).toBe("processed");
    });

    it("ignores stored span events that are not evaluations", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          {
            event_type: "exception",
            event_details: [
              {
                key: CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE,
                value: '{"name":"x"}',
              },
            ],
          },
          storedEvaluation({ name: "toxicity" }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reportEvaluation).toHaveBeenCalledTimes(1);
      expect(reported(reportEvaluation).evaluatorName).toBe("toxicity");
    });
  });

  describe("given the claim-check raced the span store's write", () => {
    /** The read resolves against a row a sibling projection is still writing. */
    it("throws so the outbox backs off and asks again", async () => {
      const { deps } = makeDeps({ spanEvents: [] });

      // The narrowing already established this span carried a verdict, so an
      // empty read is "not stored yet", never "there was nothing here".
      await expect(
        createCustomEvaluationReportHandler(deps)(intent(), CTX),
      ).rejects.toThrow(/carries no readable custom evaluation yet/);
    });

    it("throws rather than reporting nothing when every payload is unreadable", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [storedEvaluation("not json")],
      });

      await expect(
        createCustomEvaluationReportHandler(deps)(intent(), CTX),
      ).rejects.toThrow(/carries no readable custom evaluation yet/);
      expect(reportEvaluation).not.toHaveBeenCalled();
    });

    it("surfaces a failing store read rather than swallowing it", async () => {
      const { deps } = makeDeps({
        getSpanEvents: async () => {
          throw new Error("clickhouse down");
        },
      });

      await expect(
        createCustomEvaluationReportHandler(deps)(intent(), CTX),
      ).rejects.toThrow("clickhouse down");
    });
  });

  describe("given the store re-serialised the payload it stored", () => {
    /**
     * The store round-trips the payload through JSON.parse → JSON.stringify,
     * so what comes back is semantically equal but not byte-identical to what
     * the SDK sent — Python's `json.dumps` spacing alone diverges.
     */
    it("derives the same evaluation id either way", async () => {
      const asSdkSent = '{"name": "toxicity", "score": 1.0, "passed": true}';
      const asStoreReturns = JSON.stringify(JSON.parse(asSdkSent));
      expect(asStoreReturns).not.toBe(asSdkSent);

      const original = makeDeps({ spanEvents: [storedEvaluation(asSdkSent)] });
      await createCustomEvaluationReportHandler(original.deps)(intent(), CTX);

      const roundTripped = makeDeps({
        spanEvents: [storedEvaluation(asStoreReturns)],
      });
      await createCustomEvaluationReportHandler(roundTripped.deps)(
        intent(),
        CTX,
      );

      // Hashing the parsed verdict rather than the raw text is what makes the
      // claim-check safe; a text hash would give the read-back path different
      // ids and bill a second evaluation for the same verdict.
      expect(reported(roundTripped.reportEvaluation).evaluationId).toBe(
        reported(original.reportEvaluation).evaluationId,
      );
    });
  });

  describe("given an evaluation the SDK failed to run", () => {
    it("records it as an error with the message it gave", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({
            name: "toxicity",
            error: { message: "provider down", stacktrace: ["a", "b"] },
          }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation)).toMatchObject({
        status: "error",
        error: "provider down",
        errorDetails: "a\nb",
      });
    });
  });

  describe("given the SDK named its own evaluation", () => {
    it("records it under the id the SDK chose", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({ name: "toxicity", evaluation_id: "my-eval-1" }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation).evaluationId).toBe("my-eval-1");
    });

    it("records it under the evaluator the SDK chose", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({ name: "toxicity", evaluator_id: "my-evaluator" }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation).evaluatorId).toBe("my-evaluator");
    });
  });

  describe("given the SDK named neither", () => {
    it("derives an evaluator from the evaluation's name", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [storedEvaluation({ name: "My Custom Eval" })],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation).evaluatorId).toMatch(/^customeval_/);
    });

    it("derives the evaluation's id from the verdict itself", async () => {
      const { deps, reportEvaluation } = makeDeps();

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation).evaluationId).toMatch(
        /^eval_md5_[a-f0-9]{32}$/,
      );
    });

    it("gives two verdicts on one span ids of their own", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({ name: "toxicity" }),
          storedEvaluation({ name: "relevance" }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation, 0).evaluationId).not.toBe(
        reported(reportEvaluation, 1).evaluationId,
      );
    });
  });

  describe("given an evaluation the SDK typed wrong", () => {
    it("keeps the rest of the verdict", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({ name: "toxicity", score: "high", label: "safe" }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      expect(reported(reportEvaluation)).toMatchObject({
        score: null,
        label: "safe",
      });
    });

    it("drops a verdict reported without a name", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({ score: 0.5 }),
          storedEvaluation({ name: "toxicity" }),
        ],
      });

      await createCustomEvaluationReportHandler(deps)(intent(), CTX);

      // A nameless verdict cannot be attributed to an evaluator.
      expect(reportEvaluation).toHaveBeenCalledTimes(1);
      expect(reported(reportEvaluation).evaluatorName).toBe("toxicity");
    });
  });

  describe("when the outbox retries a report that partly succeeded", () => {
    it("records the same evaluation, not a second chargeable one", async () => {
      const first = makeDeps();
      await createCustomEvaluationReportHandler(first.deps)(intent(), CTX);

      const retry = makeDeps();
      await createCustomEvaluationReportHandler(retry.deps)(intent(), {
        ...CTX,
        attempt: 2,
      });

      expect(reported(retry.reportEvaluation).evaluationId).toBe(
        reported(first.reportEvaluation).evaluationId,
      );
    });

    it("records a changed verdict as an evaluation of its own", async () => {
      const first = makeDeps({
        spanEvents: [storedEvaluation({ name: "toxicity", score: 0.1 })],
      });
      await createCustomEvaluationReportHandler(first.deps)(intent(), CTX);

      const changed = makeDeps({
        spanEvents: [storedEvaluation({ name: "toxicity", score: 0.9 })],
      });
      await createCustomEvaluationReportHandler(changed.deps)(intent(), CTX);

      expect(reported(changed.reportEvaluation).evaluationId).not.toBe(
        reported(first.reportEvaluation).evaluationId,
      );
    });
  });

  describe("when an evaluation cannot be recorded", () => {
    it("throws so the outbox reports again", async () => {
      const { deps } = makeDeps({
        reportEvaluation: async () => {
          throw new Error("queue down");
        },
      });

      await expect(
        createCustomEvaluationReportHandler(deps)(intent(), CTX),
      ).rejects.toThrow("queue down");
    });

    it("records the span's other evaluations before giving up", async () => {
      const { deps, reportEvaluation } = makeDeps({
        spanEvents: [
          storedEvaluation({ name: "toxicity" }),
          storedEvaluation({ name: "relevance" }),
        ],
        reportEvaluation: async (data) => {
          if (data.evaluatorName === "toxicity") throw new Error("queue down");
        },
      });

      await expect(
        createCustomEvaluationReportHandler(deps)(intent(), CTX),
      ).rejects.toThrow("queue down");

      expect(reportEvaluation).toHaveBeenCalledTimes(2);
    });

    it("reports the failure once every evaluation has been attempted", async () => {
      const attempted: string[] = [];
      const { deps } = makeDeps({
        spanEvents: [
          storedEvaluation({ name: "toxicity" }),
          storedEvaluation({ name: "relevance" }),
        ],
        reportEvaluation: async (data) => {
          attempted.push(data.evaluatorName ?? "");
          throw new Error(`${data.evaluatorName} unreachable`);
        },
      });

      await expect(
        createCustomEvaluationReportHandler(deps)(intent(), CTX),
      ).rejects.toThrow("toxicity unreachable");

      expect(attempted).toEqual(["toxicity", "relevance"]);
    });

    it("throws an Error even when the failure was not one", async () => {
      const { deps } = makeDeps({
        reportEvaluation: async () => {
          throw "queue down";
        },
      });

      await expect(
        createCustomEvaluationReportHandler(deps)(intent(), CTX),
      ).rejects.toThrow("queue down");
    });
  });
});
