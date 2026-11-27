/**
 * The assumption the evaluation_metrics dedup floor rests on: a newer version of an evaluation is
 * never written with an earlier OccurredAt. The fold writes OccurredAt as the running max of the
 * event times it has applied, whatever order the events are accepted in.
 * @see modules/analytics/adrs/005-evaluation-metrics-dedup-floor.md
 */
import { describe, expect, it } from "vitest";

import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  EvaluationAnalyticsFoldProjection,
} from "../eventing/evaluation-analytics-fold.projection.ts";
import {
  type EvaluationAnalyticsData,
  EvaluationAnalyticsRowProjection,
} from "../eventing/evaluation-analytics-row.projection.ts";
import {
  createEvaluationCompletedEvent,
  createEvaluationScheduledEvent,
  createEvaluationStartedEvent,
} from "./eventing/fixtures/evaluation-events.fixtures.ts";

const rowProjection = EvaluationAnalyticsRowProjection.create();
const LATE = 2_000_000;
const EARLY = 1_500_000;
const EARLIEST = 1_000_000;

const fold = EvaluationAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
});

const rowOf = (state: EvaluationAnalyticsData) =>
  rowProjection.project({
    state,
    tenantId: "proj-eval",
    version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  });

describe("given evaluation events accepted out of their occurred order", () => {
  it("keeps OccurredAt at the latest event time while UpdatedAt keeps rising", () => {
    const first = fold.apply(fold.init(), createEvaluationScheduledEvent({ occurredAt: LATE }));
    const second = fold.apply(first, createEvaluationStartedEvent({ occurredAt: EARLY }));
    const third = fold.apply(second, createEvaluationCompletedEvent({ occurredAt: EARLIEST }));

    const versions = [first, second, third].map(rowOf);

    expect(versions.map((row) => row.occurredAtMs)).toEqual([LATE, LATE, LATE]);
    expect(versions[1]!.updatedAtMs).toBeGreaterThan(versions[0]!.updatedAtMs);
    expect(versions[2]!.updatedAtMs).toBeGreaterThan(versions[1]!.updatedAtMs);
  });

  it("raises OccurredAt when a later-accepted event did occur later", () => {
    const first = fold.apply(fold.init(), createEvaluationScheduledEvent({ occurredAt: EARLY }));
    const second = fold.apply(first, createEvaluationCompletedEvent({ occurredAt: LATE }));

    expect(rowOf(second).occurredAtMs).toBe(LATE);
  });
});

describe("given a stored version read back before an earlier event is applied", () => {
  it("writes the next version at the stored OccurredAt, never below it", () => {
    const stored = rowOf(
      fold.apply(fold.init(), createEvaluationScheduledEvent({ occurredAt: LATE })),
    );

    const next = rowOf(
      fold.apply(
        rowProjection.fromRow(stored),
        createEvaluationCompletedEvent({ occurredAt: EARLY }),
      ),
    );

    expect(next.occurredAtMs).toBe(LATE);
    expect(next.updatedAtMs).toBeGreaterThan(stored.updatedAtMs);
  });
});
