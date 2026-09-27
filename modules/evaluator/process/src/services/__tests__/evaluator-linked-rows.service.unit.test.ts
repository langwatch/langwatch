import { createApiFixture } from "@langwatch/api-fixture";
import { Temporal, toDate } from "@langwatch/time";
import {
  studioWorkflowSchema,
  workflowSchema,
  workflowVersionSchema,
  type WorkflowApi,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import {
  EvaluatorLinkedRowsService,
  type EvaluatorMonitorRows,
} from "../evaluator-linked-rows.service.ts";

const timestamp = toDate(Temporal.Instant.fromEpochMilliseconds(0));
const dsl = studioWorkflowSchema.parse({
  spec_version: "1.5",
  name: "Judge",
  icon: "🧪",
  description: "",
  version: "1.0",
  nodes: [],
  edges: [],
});

function linkedWorkflow({ withVersion }: { withVersion: boolean }): WorkflowWithVersion {
  const version = workflowVersionSchema.parse({
    id: "version_1",
    workflowId: "workflow_1",
    projectId: "project_source",
    version: "1",
    autoSaved: false,
    commitMessage: "Saved",
    authorId: "user_1",
    parentId: null,
    dsl,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    ...workflowSchema.parse({
      id: "workflow_1",
      projectId: "project_source",
      name: "Judge",
      icon: null,
      description: null,
      latestVersionId: withVersion ? version.id : null,
      currentVersionId: withVersion ? version.id : null,
      publishedId: null,
      publishedById: null,
      copiedFromWorkflowId: null,
      isEvaluator: true,
      isComponent: false,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    latestVersion: withVersion ? version : null,
  };
}

const monitors: EvaluatorMonitorRows = {
  findMonitorsUsingEvaluator: async () => [],
  deleteMonitorsUsingEvaluator: async () => ({ count: 0 }),
};

const replication = {
  workflowId: "workflow_1",
  sourceProjectId: "project_source",
  targetProjectId: "project_target",
  actorId: "user_1",
};

describe("EvaluatorLinkedRowsService", () => {
  describe("when the linked workflow is read", () => {
    it("answers the workflow's summary through the workflow module", async () => {
      const listSummaries = vi.fn(async () => [{ id: "workflow_1", name: "Judge" }]);
      const rows = EvaluatorLinkedRowsService.create({
        workflows: createApiFixture<WorkflowApi>({ listSummaries }),
        monitors,
      });

      await expect(
        rows.findLinkedWorkflow({ workflowId: "workflow_1", projectId: "project_source" }),
      ).resolves.toEqual({ id: "workflow_1", name: "Judge" });
      expect(listSummaries).toHaveBeenCalledWith({
        projectId: "project_source",
        workflowIds: ["workflow_1"],
      });
    });

    it("answers null for an archived or missing workflow", async () => {
      const rows = EvaluatorLinkedRowsService.create({
        workflows: createApiFixture<WorkflowApi>({ listSummaries: async () => [] }),
        monitors,
      });

      await expect(
        rows.findLinkedWorkflow({ workflowId: "workflow_1", projectId: "project_source" }),
      ).resolves.toBeNull();
    });
  });

  describe("when an evaluator's workflow is replicated", () => {
    it("refuses a workflow with no saved version", async () => {
      const rows = EvaluatorLinkedRowsService.create({
        workflows: createApiFixture<WorkflowApi>({
          listSummaries: async () => [{ id: "workflow_1", name: "Judge" }],
          getById: async () => linkedWorkflow({ withVersion: false }),
        }),
        monitors,
      });

      await expect(rows.replicateEvaluatorWorkflow(replication)).rejects.toMatchObject({
        code: "evaluator_workflow_version_required",
      });
    });

    it("removes the copy when its first version cannot be saved", async () => {
      const deleteUncommitted = vi.fn(async () => undefined);
      const rows = EvaluatorLinkedRowsService.create({
        workflows: createApiFixture<WorkflowApi>({
          listSummaries: async () => [{ id: "workflow_1", name: "Judge" }],
          getById: async () => linkedWorkflow({ withVersion: true }),
          copyStudioWorkflow: async () => ({ workflowId: "workflow_copy", dsl }),
          saveStudioVersion: async () => {
            throw new Error("save failed");
          },
          deleteUncommitted,
        }),
        monitors,
      });

      await expect(rows.replicateEvaluatorWorkflow(replication)).rejects.toThrow("save failed");
      expect(deleteUncommitted).toHaveBeenCalledWith({
        workflowId: "workflow_copy",
        projectId: "project_target",
      });
    });
  });
});
