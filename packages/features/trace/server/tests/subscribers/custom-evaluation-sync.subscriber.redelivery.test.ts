/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for the `customEvaluationSync` subscriber, required by
 * the `eventing-subscriber-idempotency` architecture rule.
 *
 * What makes it hold: the subscriber names nothing from the clock. An SDK
 * evaluation carrying no `evaluation_id` gets one hashed from the trace id and
 * the evaluation payload, and the report's `occurredAt` is copied from the
 * source event rather than read from `Date.now()`. The evaluation store keys on
 * `evaluationId`, so a second delivery of one span asks for the same evaluation
 * to be recorded again, not for a second one.
 *
 * Queue deduplication is NOT what makes this safe: the dedup id
 * (`tenantId:aggregateId:eventId`) carries a 30-second TTL, and a redelivery
 * after a worker crash routinely lands outside it.
 *
 * The clock is pinned throughout, because `hasSyncableEvaluations` drops any
 * event older than an hour — see the last case, which is the one place the
 * clock decides anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";
import { createCustomEvaluationSyncHandler } from "../../src/subscribers/custom-evaluation-sync.subscriber";
import {
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
  OCCURRED_AT,
} from "./support/trace-subscriber.fixtures";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const ONE_HOUR_MS = 60 * 60 * 1000;

function makeEvaluationSink() {
  const reported: ReportEvaluationCommandData[] = [];
  return {
    reported,
    deps: {
      reportEvaluation: async (data: ReportEvaluationCommandData) => {
        reported.push(data);
      },
      deriveEvaluatorId: (name: string) => `customeval_${name}`,
    },
    /** The identity the evaluation store collapses on. */
    identities(): Set<string> {
      return new Set(reported.map((data) => `${data.tenantId}:${data.evaluationId}`));
    },
  };
}

const span = createOtlpSpan([
  { name: "langwatch.evaluation.custom", payload: { name: "toxicity", score: 0.1, passed: true } },
]);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(OCCURRED_AT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given one span carrying an SDK evaluation", () => {
  describe("when the same span_received event is handled twice", () => {
    it("reports one evaluation identity across both deliveries", async () => {
      const sink = makeEvaluationSink();
      const handler = createCustomEvaluationSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(span);

      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      expect(sink.reported).toHaveLength(2);
      expect(sink.identities().size).toBe(1);
    });

    it("reports the byte-identical command both times", async () => {
      const sink = makeEvaluationSink();
      const handler = createCustomEvaluationSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(span);

      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      const [first, second] = sink.reported;
      expect(second).toEqual(first);
      expect(first?.occurredAt).toBe(event.occurredAt);
    });

    /**
     * The retry that matters: a worker crash puts minutes between the two
     * deliveries, well past the queue's 30-second dedup TTL. A `Date.now()`
     * anywhere in the identity would make this a second verdict on one SDK
     * call, and the trace would show the evaluation twice.
     */
    it("keeps the identity when the redelivery is half an hour later", async () => {
      const sink = makeEvaluationSink();
      const handler = createCustomEvaluationSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(span);

      await handler(event, createContext(createFoldState()));
      vi.setSystemTime(new Date(OCCURRED_AT + 30 * 60 * 1000));
      await handler(event, createContext(createFoldState()));

      expect(sink.reported).toHaveLength(2);
      expect(sink.identities().size).toBe(1);
      expect(sink.reported[1]).toEqual(sink.reported[0]);
    });
  });

  describe("when the evaluation names its own evaluation_id", () => {
    it("uses that id on every delivery, so the SDK's own key wins", async () => {
      const sink = makeEvaluationSink();
      const handler = createCustomEvaluationSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(
        createOtlpSpan([
          {
            name: "langwatch.evaluation.custom",
            payload: { name: "toxicity", evaluation_id: "eval-from-sdk", score: 0.1 },
          },
        ]),
      );

      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      expect(sink.identities()).toEqual(new Set(["tenant-1:eval-from-sdk"]));
    });
  });

  describe("when the redelivery arrives after the staleness threshold", () => {
    /**
     * The other half of the contract, and the reason a resync flood cannot
     * re-report a backlog: past an hour the subscriber declines the event
     * outright rather than reporting an identical evaluation again.
     */
    it("reports nothing further", async () => {
      const sink = makeEvaluationSink();
      const handler = createCustomEvaluationSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(span);

      await handler(event, createContext(createFoldState()));
      vi.setSystemTime(new Date(OCCURRED_AT + ONE_HOUR_MS + 1_000));
      await handler(event, createContext(createFoldState()));

      expect(sink.reported).toHaveLength(1);
    });
  });
});

describe("given two different evaluations on one span", () => {
  it("keeps them apart, so idempotency is not collapsing real facts", async () => {
    const sink = makeEvaluationSink();
    const handler = createCustomEvaluationSyncHandler(sink.deps);
    const event = createSpanReceivedEvent(
      createOtlpSpan([
        { name: "langwatch.evaluation.custom", payload: { name: "toxicity", score: 0.1 } },
        { name: "langwatch.evaluation.custom", payload: { name: "relevance", score: 0.9 } },
      ]),
    );

    await handler(event, createContext(createFoldState()));
    await handler(event, createContext(createFoldState()));

    expect(sink.identities().size).toBe(2);
  });
});
