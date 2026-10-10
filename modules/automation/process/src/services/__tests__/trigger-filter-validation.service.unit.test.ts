import type { Evaluator } from "@langwatch/evaluator-contract";
import { describe, expect, it, vi } from "vitest";

import { TriggerFilterValidationService } from "../trigger-filter-validation.service.ts";

function evaluator(id: string): Evaluator {
  return {
    id,
    projectId: "project_1",
    name: id,
    slug: null,
    type: "evaluator",
    config: null,
    workflowId: null,
    copiedFromEvaluatorId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function validation({
  evaluators = [],
  monitors = {},
}: {
  evaluators?: string[];
  monitors?: Record<string, string[]>;
}) {
  const findById = vi.fn(async ({ id }: { id: string; projectId: string }) =>
    evaluators.includes(id) ? evaluator(id) : undefined,
  );
  const findByEvaluator = vi.fn(
    async ({ evaluatorId }: { projectId: string; evaluatorId: string }) =>
      (monitors[evaluatorId] ?? []).map((monitorId) => ({ id: monitorId, name: monitorId })),
  );
  return {
    service: TriggerFilterValidationService.create({
      evaluators: { findById },
      monitors: { findByEvaluator },
    }),
    findById,
  };
}

describe("TriggerFilterValidationService.assertWritable()", () => {
  describe("when a keyed field is a bare list", () => {
    /** @scenario "A keyed condition written without its key is refused" */
    it("refuses with trigger_filter_key_required", async () => {
      await expect(
        validation({}).service.assertWritable({
          projectId: "project_1",
          filters: { "evaluations.passed": ["false"] },
        }),
      ).rejects.toMatchObject({ code: "trigger_filter_key_required" });
    });
  });

  describe("when an evaluation condition is keyed by an evaluator id", () => {
    /** @scenario "An evaluation condition keyed by an evaluator names its monitors" */
    it("refuses with trigger_filter_monitor_required naming the monitors", async () => {
      await expect(
        validation({
          evaluators: ["evaluator_1"],
          monitors: { evaluator_1: ["monitor_1"] },
        }).service.assertWritable({
          projectId: "project_1",
          filters: { "evaluations.passed": { evaluator_1: ["true"] } },
        }),
      ).rejects.toMatchObject({ code: "trigger_filter_monitor_required" });
    });

    it("still refuses when no monitor runs that evaluator", async () => {
      await expect(
        validation({ evaluators: ["evaluator_1"] }).service.assertWritable({
          projectId: "project_1",
          filters: { "evaluations.passed": { evaluator_1: ["true"] } },
        }),
      ).rejects.toMatchObject({ code: "trigger_filter_monitor_required" });
    });
  });

  describe("when the ids are monitors or SDK evaluator ids", () => {
    it("accepts the conditions", async () => {
      await expect(
        validation({}).service.assertWritable({
          projectId: "project_1",
          filters: {
            "evaluations.passed": { monitor_1: ["true"] },
            "evaluations.evaluator_id": ["sdk-judge"],
          },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when no evaluation condition is stated", () => {
    it("does not query", async () => {
      const { service, findById } = validation({});
      await service.assertWritable({
        projectId: "project_1",
        filters: { "traces.error": ["true"] },
      });
      expect(findById).not.toHaveBeenCalled();
    });
  });
});
