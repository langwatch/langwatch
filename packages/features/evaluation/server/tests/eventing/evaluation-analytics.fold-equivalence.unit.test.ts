import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsData,
  EvaluationAnalyticsFoldProjection,
  type EvaluationAnalyticsRow,
  EvaluationAnalyticsRowProjection,
} from "@langwatch/evaluation-server/internal";
import {
  createEvaluationCompletedEvent,
  createEvaluationScheduledEvent,
  createEvaluationStartedEvent,
} from "./fixtures/evaluation-events.fixtures";
import { PreserveEvaluationAnalyticsAttributes } from "./fixtures/preserve-attributes.policy";

/**
 * FOLD-EQUIVALENCE for the slim evaluation fold's read-back (ADR-066).
 *
 * `evaluationAnalytics.readBack.unit.test.ts` proves a fixed point —
 * `project(fromRow(project(s))) === project(s)`. That only says the row is
 * stable under re-writing; it says nothing about what happens when the NEXT
 * event folds onto the reconstructed state. The property the read-back really
 * rests on is:
 *
 *     fold(events, fromRow(project(s))) === fold(events, s)
 *
 * For this fold the sharp edge is `DurationMs`: it is derived from StartedAt and
 * CompletedAt, so a read-back that lost StartedAt would compute zero durations
 * over real ones — and the fixed point would still pass, because both sides of it
 * see the same lost value.
 *
 * State is folded out of real lifecycle events through the projection's own
 * dispatch, never written as a literal.
 */

const TENANT = "proj-eval-equiv";
const EVALUATION_ID = "eval-equiv";
const BASE_MS = 1_760_000_000_000;
const attributePolicy = new PreserveEvaluationAnalyticsAttributes();
const rowProjection = EvaluationAnalyticsRowProjection.create();

const projection = new EvaluationAnalyticsFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function project(state: EvaluationAnalyticsData): EvaluationAnalyticsRow {
  return rowProjection.project({
    state,
    tenantId: TENANT,
    version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
    attributePolicy,
  });
}

/** The persistence boundary, round-tripped: state → row → state. */
function roundTrip(state: EvaluationAnalyticsData): EvaluationAnalyticsData {
  return rowProjection.fromRow(project(state));
}

type FoldEvent = { type: string };

function foldAll(
  events: readonly FoldEvent[],
  from: EvaluationAnalyticsData,
): EvaluationAnalyticsData {
  return events.reduce((state, event) => projection.apply(state, event), from);
}

/**
 * A guardrail evaluation that errors, is retried, and finally passes — the
 * ordinary shape of a monitor run. Both terminal transitions recompute
 * `DurationMs` from the lifecycle operands the row has to carry back.
 */
function evaluationLifecycle(): readonly FoldEvent[] {
  return [
    createEvaluationScheduledEvent({
      eventId: "evt-scheduled",
      tenantId: TENANT,
      evaluationId: EVALUATION_ID,
      occurredAt: BASE_MS,
      evaluatorId: "monitor-x",
      traceId: "trace-9",
      isGuardrail: true,
      metadata: { "metadata.team": "platform", "metadata.attempt": 1 },
    }),
    createEvaluationStartedEvent({
      eventId: "evt-started",
      tenantId: TENANT,
      evaluationId: EVALUATION_ID,
      occurredAt: BASE_MS + 1_000,
    }),
    createEvaluationCompletedEvent({
      eventId: "evt-failed",
      tenantId: TENANT,
      evaluationId: EVALUATION_ID,
      occurredAt: BASE_MS + 3_000,
      status: "error",
      score: null,
      passed: null,
      label: null,
      costId: "cost-1",
    }),
    createEvaluationStartedEvent({
      eventId: "evt-restarted",
      tenantId: TENANT,
      evaluationId: EVALUATION_ID,
      occurredAt: BASE_MS + 10_000,
    }),
    createEvaluationCompletedEvent({
      eventId: "evt-passed",
      tenantId: TENANT,
      evaluationId: EVALUATION_ID,
      occurredAt: BASE_MS + 12_500,
      status: "processed",
      score: 0.87,
      passed: true,
      label: "match",
      costId: "cost-2",
      metadata: { "metadata.attempt": 2 },
    }),
  ];
}

const LIFECYCLE = evaluationLifecycle();
/** Every interior boundary — the property has to hold wherever the crash lands. */
const SPLIT_POINTS = LIFECYCLE.map((_, index) => index + 1).slice(0, -1);

describe("evaluationAnalytics fold-equivalence across the read-back boundary", () => {
  // The base class stamps `updatedAt` as `max(Date.now(), previous + 1)`. Frozen
  // time makes that purely a function of the previous value, so the two folds can
  // be compared on EVERY column instead of excusing a wall-clock one.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  describe("given an evaluation folded from its real lifecycle events", () => {
    describe.each(SPLIT_POINTS)(
      "when the fold is interrupted after event %i and resumed from the committed row",
      (splitAt) => {
        const before = LIFECYCLE.slice(0, splitAt);
        const after = LIFECYCLE.slice(splitAt);

        it("reaches the same row as the fold that never lost its state", () => {
          const committed = foldAll(before, projection.init());

          const uninterrupted = foldAll(after, committed);
          const resumed = foldAll(after, roundTrip(committed));

          expect(project(resumed)).toEqual(project(uninterrupted));
        });
      },
    );

    it("measures the retry's real duration after resuming from the row", () => {
      // Sanity anchor for the property above: the terminal event that lands
      // after the interruption derives DurationMs from an operand only the
      // read-back column can supply.
      const committed = foldAll(LIFECYCLE.slice(0, 4), projection.init());

      const resumed = foldAll(LIFECYCLE.slice(4), roundTrip(committed));

      expect(project(resumed).durationMs).toBe(2_500);
    });
  });
});

/**
 * Round-trip disposition for every field of the fold's working state.
 *
 * This table is the exhaustiveness guard: it is typed as a total map over
 * `keyof EvaluationAnalyticsData`, so ADDING a field to the state type fails to
 * compile until someone records what happens to it across the persistence
 * boundary — and the runtime key check below catches a field that exists on a
 * folded state without existing on the type.
 */
type RoundTripDisposition =
  /** The row carries a column for it and `fromRow` restores it verbatim. */
  | "restored"
  /** Deliberately lossy: the write-time trim decides what survives. */
  | "trimmed-at-write"
  /** No column, by design — it feeds no projected value (fold docblock). */
  | "dropped-by-design";

const EVALUATION_STATE_DISPOSITION = {
  evaluationId: "restored",
  evaluatorId: "dropped-by-design",
  evaluatorType: "restored",
  evaluatorName: "restored",
  status: "restored",
  isGuardrail: "restored",
  passed: "restored",
  score: "restored",
  label: "restored",
  model: "restored",
  traceId: "restored",
  scheduledAt: "dropped-by-design",
  startedAt: "restored",
  completedAt: "restored",
  costId: "dropped-by-design",
  attributes: "trimmed-at-write",
  createdAt: "restored",
  updatedAt: "restored",
  LastEventOccurredAt: "restored",
} satisfies Record<keyof EvaluationAnalyticsData, RoundTripDisposition>;

/** What `fromRow` puts there instead, for the fields with no column. */
const DROPPED_FIELD_DEFAULTS: Partial<EvaluationAnalyticsData> = {
  evaluatorId: "",
  scheduledAt: null,
  costId: null,
};

describe("evaluationAnalytics read-back field coverage", () => {
  describe("given a state folded from the full lifecycle", () => {
    const state = foldAll(LIFECYCLE, projection.init());
    const decoded = roundTrip(state);

    it("accounts for every field the fold actually carries", () => {
      // A new state field with no entry above fails to compile; one that only
      // exists at runtime fails here.
      expect(Object.keys(state).sort()).toEqual(Object.keys(EVALUATION_STATE_DISPOSITION).sort());
      expect(Object.keys(decoded).sort()).toEqual(Object.keys(EVALUATION_STATE_DISPOSITION).sort());
    });

    it.each(
      Object.entries(EVALUATION_STATE_DISPOSITION)
        .filter(([, disposition]) => disposition === "restored")
        .map(([field]) => field as keyof EvaluationAnalyticsData),
    )("restores %s verbatim from the row", (field) => {
      expect(decoded[field]).toEqual(state[field]);
    });

    it.each(
      Object.entries(EVALUATION_STATE_DISPOSITION)
        .filter(([, disposition]) => disposition === "dropped-by-design")
        .map(([field]) => field as keyof EvaluationAnalyticsData),
    )("drops %s back to its documented default", (field) => {
      // The fold really did carry a value — so this is a drop, not an accident
      // of an empty fixture — and the equivalence property above is what says
      // the drop costs no projected column.
      expect(state[field]).not.toEqual(DROPPED_FIELD_DEFAULTS[field]);
      expect(decoded[field]).toEqual(DROPPED_FIELD_DEFAULTS[field]);
    });

    describe("when the trimmed attribute map is decoded", () => {
      it("keeps the metadata dimensions the events merged in", () => {
        expect(decoded.attributes["metadata.team"]).toBe("platform");
        expect(decoded.attributes["metadata.attempt"]).toBe("2");
      });
    });
  });
});
