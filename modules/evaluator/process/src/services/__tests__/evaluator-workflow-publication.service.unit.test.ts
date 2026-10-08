import type { Evaluator } from "@langwatch/evaluator-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { EvaluatorWorkflowPublicationService } from "../evaluator-workflow-publication.service.ts";
import type { EvaluatorService } from "../evaluator.service.ts";

const existingEvaluator: Evaluator = {
  id: "evaluator_1",
  projectId: "project_1",
  name: "previous name",
  slug: null,
  type: "workflow",
  config: {},
  workflowId: "workflow_archived",
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const archivedFlags = {
  id: "workflow_archived",
  name: "Archived quality check",
  publishedId: "published_1",
  isComponent: false,
  isEvaluator: false,
};

function serviceWith({
  flags,
  linked,
}: {
  flags: Awaited<ReturnType<WorkflowApi["findWorkflowFlags"]>>;
  linked: Evaluator[];
}) {
  const workflows = {
    findWorkflowFlags: vi.fn<WorkflowApi["findWorkflowFlags"]>(async () => flags),
    setWorkflowFlags: vi.fn<WorkflowApi["setWorkflowFlags"]>(async () => undefined),
  };
  const evaluators = {
    findByWorkflow: vi.fn<EvaluatorService["findByWorkflow"]>(async () => linked),
    create: vi.fn<EvaluatorService["create"]>(async () => existingEvaluator),
    update: vi.fn<EvaluatorService["update"]>(async () => existingEvaluator),
    archive: vi.fn<EvaluatorService["archive"]>(async () => existingEvaluator),
  };

  return {
    workflows,
    evaluators,
    service: EvaluatorWorkflowPublicationService.create({ workflows, evaluators }),
  };
}

describe("the studio's evaluator switch", () => {
  describe("given an archived workflow whose publication row still exists", () => {
    /** @scenario "An archived workflow keeps its evaluator publication behaviour" */
    it("sets both flags and renames the evaluator to the publication row's name", async () => {
      const { workflows, evaluators, service } = serviceWith({
        flags: archivedFlags,
        linked: [existingEvaluator],
      });

      await service.toggleSaveAsEvaluator({
        workflowId: "workflow_archived",
        projectId: "project_1",
        isEvaluator: true,
      });

      expect(workflows.setWorkflowFlags).toHaveBeenCalledWith({
        workflowId: "workflow_archived",
        projectId: "project_1",
        isEvaluator: true,
        isComponent: false,
      });
      expect(evaluators.update).toHaveBeenCalledWith({
        id: "evaluator_1",
        projectId: "project_1",
        data: { name: "Archived quality check" },
      });
      expect(evaluators.create).not.toHaveBeenCalled();
    });
  });

  describe("given a workflow no evaluator wraps yet", () => {
    /** @scenario "Saving a workflow as an evaluator creates the one evaluator that wraps it" */
    it("creates a workflow evaluator named after the workflow", async () => {
      const { evaluators, service } = serviceWith({ flags: archivedFlags, linked: [] });

      await service.toggleSaveAsEvaluator({
        workflowId: "workflow_archived",
        projectId: "project_1",
        isEvaluator: true,
      });

      expect(evaluators.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_1",
          name: "Archived quality check",
          type: "workflow",
          config: {},
          workflowId: "workflow_archived",
        }),
      );
    });
  });

  describe("given no workflow publication row exists", () => {
    /** @scenario "Saving a missing workflow as an evaluator refuses before publication changes" */
    it("refuses with workflow_not_found before flags or evaluator rows change", async () => {
      const { workflows, evaluators, service } = serviceWith({ flags: null, linked: [] });

      await expect(
        service.toggleSaveAsEvaluator({
          workflowId: "workflow_missing",
          projectId: "project_1",
          isEvaluator: true,
        }),
      ).rejects.toMatchObject({ code: "workflow_not_found", httpStatus: 404 });

      expect(workflows.setWorkflowFlags).not.toHaveBeenCalled();
      expect(evaluators.create).not.toHaveBeenCalled();
      expect(evaluators.update).not.toHaveBeenCalled();
    });
  });

  describe("given a workflow published as an evaluator is switched off", () => {
    /** @scenario "Switching a workflow off as an evaluator archives the evaluator that wrapped it" */
    it("clears the evaluator flag and archives the linked evaluator", async () => {
      const { workflows, evaluators, service } = serviceWith({
        flags: archivedFlags,
        linked: [existingEvaluator],
      });

      await service.disableAsEvaluator({ workflowId: "workflow_archived", projectId: "project_1" });

      expect(workflows.setWorkflowFlags).toHaveBeenCalledWith({
        workflowId: "workflow_archived",
        projectId: "project_1",
        isEvaluator: false,
      });
      expect(evaluators.archive).toHaveBeenCalledWith({
        id: "evaluator_1",
        projectId: "project_1",
      });
    });

    /** @scenario "Switching a workflow off as an evaluator archives the evaluator that wrapped it" */
    it("archives nothing when no evaluator wraps the workflow", async () => {
      const { evaluators, service } = serviceWith({ flags: archivedFlags, linked: [] });

      await service.disableAsEvaluator({ workflowId: "workflow_archived", projectId: "project_1" });

      expect(evaluators.archive).not.toHaveBeenCalled();
    });
  });
});
