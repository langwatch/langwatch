/**
 * Main's trace reactors' queued jobs run on evaluation's lanes for one release.
 * Spec: modules/evaluation/specs/trace-evaluation-trigger.feature
 */
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { ORIGIN_RESOLVED_EVENT_TYPE, SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { EvaluationExecutionIntentService } from "../../features/execution/services/evaluation-execution-intent.service.ts";
import type { EvaluationAnalyticsRollupRow } from "../evaluation-analytics-rollup.projection.ts";
import type { EvaluationAnalyticsData } from "../evaluation-analytics-row.projection.ts";
import { ExecuteEvaluationCommand } from "../evaluation-execution.intent.ts";
import {
  createEvaluationProcessingPipeline,
  type EvaluationTraceReactions,
} from "../evaluation-processing-definition.pipeline.ts";

function build({ traceReactions }: { traceReactions?: EvaluationTraceReactions }) {
  return createEvaluationProcessingPipeline({
    evalRunStore: createApiFixture<FoldProjectionStore<EvaluationRunData>>({}),
    evaluationAnalyticsStore: createApiFixture<FoldProjectionStore<EvaluationAnalyticsData>>({}),
    evaluationAnalyticsRollupAppendStore: createApiFixture<
      AppendStore<EvaluationAnalyticsRollupRow>
    >({}),
    executeEvaluationCommand: ExecuteEvaluationCommand.create(
      createApiFixture<Pick<EvaluationExecutionIntentService, "execute">>({}),
    ),
    traceReactions,
  });
}

const traceReactions: EvaluationTraceReactions = {
  evaluationTrigger: vi.fn(async () => undefined),
  customEvaluationSync: vi.fn(async () => undefined),
  collectorEvaluation: vi.fn(async () => undefined),
};

describe("evaluation_processing's aliases of main's trace reactor lanes", () => {
  describe("when evaluation registers its reactions to trace's span facts", () => {
    /** @scenario "Trigger jobs the previous release queued on trace run on evaluation's lanes" */
    it("splits main's trigger lane by event type across its two trigger lanes", () => {
      const { laneAliases } = build({ traceReactions });

      expect(
        laneAliases?.filter(({ from }) => from === "trace_processing:reactor:evaluationTrigger"),
      ).toEqual([
        {
          from: "trace_processing:reactor:evaluationTrigger",
          to: { jobType: "subscriber", lane: "traceEvaluationTrigger" },
          eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
        },
        {
          from: "trace_processing:reactor:evaluationTrigger",
          to: { jobType: "subscriber", lane: "traceOriginEvaluationTrigger" },
          eventTypes: [ORIGIN_RESOLVED_EVENT_TYPE],
        },
      ]);
    });

    /** @scenario "SDK-evaluation jobs the previous release queued on trace run on evaluation's lane" */
    it("aliases main's SDK-evaluation lane to its own", () => {
      const { laneAliases } = build({ traceReactions });

      expect(
        laneAliases?.filter(({ from }) => from === "trace_processing:reactor:customEvaluationSync"),
      ).toEqual([
        {
          from: "trace_processing:reactor:customEvaluationSync",
          to: { jobType: "subscriber", lane: "traceCustomEvaluationSync" },
          eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
        },
      ]);
    });
  });

  describe("when no trace pipeline runs in the process", () => {
    /** @scenario "A process with no trace reactions declares no alias" */
    it("declares no alias", () => {
      expect(build({}).laneAliases).toBeUndefined();
    });
  });
});
