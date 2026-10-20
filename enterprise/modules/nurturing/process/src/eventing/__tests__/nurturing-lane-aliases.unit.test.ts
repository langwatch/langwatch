// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Main's Customer.io sync lanes reach nurturing's lanes, or are acknowledged, for one release.
 * Spec: enterprise/modules/nurturing/specs/nurturing.feature
 */
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  buildNurturingPipeline,
  mainEvaluationSyncAsLifecycleCompleted,
} from "../nurturing.pipeline.ts";

function laneAliases() {
  return buildNurturingPipeline({
    deliver: async () => undefined,
    projectCreated: async () => undefined,
    guidedTurnFailed: async () => undefined,
    usageReportReceived: async () => undefined,
    evaluationsCompleted: async () => [],
    simulationRunsFinished: async () => [],
  }).laneAliases;
}

function aliasesOf(from: string) {
  return laneAliases()?.filter((alias) => alias.from === from);
}

/** A job main's customerIoEvaluationSync reactor queued: the event and the run's fold state. */
function mainEvaluationSyncJob() {
  return {
    event: {
      id: "evt-1",
      tenantId: "project-1",
      aggregateId: "eval-1",
      aggregateType: "evaluation",
      type: EVALUATION_COMPLETED_EVENT_TYPE,
      occurredAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_001,
      data: { status: "processed" },
    },
    foldState: {
      evaluationId: "eval-1",
      evaluatorType: "langevals/exact_match",
      score: 1,
      passed: true,
      label: null,
    },
  };
}

describe("nurturing's aliases of main's Customer.io sync lanes", () => {
  describe("when nurturing's pipeline is built", () => {
    /** @scenario "Simulation sync jobs the previous release queued reach nurturing's finished-run lane" */
    it("aliases main's simulation sync to its finished-run lane for finished runs", () => {
      expect(aliasesOf("simulation_processing:reactor:customerIoSimulationSync")).toEqual([
        {
          from: "simulation_processing:reactor:customerIoSimulationSync",
          to: { jobType: "subscriber", lane: "simulationRunFinished" },
          eventTypes: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
        },
      ]);
    });

    /** @scenario "Trace sync jobs the previous release queued are acknowledged, not sent twice" */
    it("tombstones main's trace sync, naming the lane that records its facts", () => {
      expect(aliasesOf("trace_processing:reactor:customerIoTraceSync")).toEqual([
        {
          from: "trace_processing:reactor:customerIoTraceSync",
          tombstone: expect.stringContaining("projectMetadata"),
        },
      ]);
    });
  });

  describe("given a settled evaluation's job main queued under its evaluation sync key", () => {
    /** @scenario "Evaluation sync jobs the previous release queued reach nurturing as a settled evaluation" */
    it("aliases the key to the settled-evaluation lane through the body transform", () => {
      expect(aliasesOf("evaluation_processing:reactor:customerIoEvaluationSync")).toEqual([
        {
          from: "evaluation_processing:reactor:customerIoEvaluationSync",
          to: { jobType: "subscriber", lane: "evaluationCompleted" },
          eventTypes: [EVALUATION_COMPLETED_EVENT_TYPE, EVALUATION_REPORTED_EVENT_TYPE],
          data: mainEvaluationSyncAsLifecycleCompleted,
        },
      ]);
    });

    /** @scenario "Evaluation sync jobs the previous release queued reach nurturing as a settled evaluation" */
    it("reads it as the settled-evaluation fact the lane parses, keyed by the evaluation", () => {
      const body = mainEvaluationSyncAsLifecycleCompleted(mainEvaluationSyncJob());

      expect(body).toMatchObject({
        id: "evt-1",
        tenantId: "project-1",
        aggregateId: "eval-1",
        type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
      });
      expect(evaluationLifecycleCompletedEventDataSchema.parse(body.data)).toEqual({
        tenantId: "project-1",
        occurredAt: 1_700_000_000_000,
        projectId: "project-1",
        evaluationId: "eval-1",
        evaluatorType: "langevals/exact_match",
        score: 1,
        passed: true,
      });
    });
  });
});
