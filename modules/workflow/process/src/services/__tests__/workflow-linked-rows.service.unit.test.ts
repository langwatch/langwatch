/**
 * @vitest-environment node
 * @see modules/workflow/specs/workflow-service.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Workflow } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { WorkflowLinkedRowsService } from "../workflow-linked-rows.service.ts";
import type { WorkflowService } from "../workflow.service.ts";

const NOW = new Date("2026-09-28T00:00:00.000Z");

const archivedWorkflow: Workflow = {
  id: "workflow_1",
  projectId: "project_1",
  name: "Quality check",
  icon: null,
  description: null,
  latestVersionId: null,
  currentVersionId: null,
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  isEvaluator: true,
  isComponent: false,
  archivedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("the workflow's linked rows", () => {
  describe("when a workflow an agent runs is archived with its dependants", () => {
    /** @scenario "Archiving a workflow takes its agents with it, and its evaluators and monitors after a lag" */
    it("archives the agent then the workflow, and leaves evaluators and monitors to their owners", async () => {
      const calls: string[] = [];
      const service = WorkflowLinkedRowsService.create({
        workflows: {
          archive: async (input) => {
            calls.push(`workflow ${input.id}`);
            return archivedWorkflow;
          },
        } satisfies Pick<WorkflowService, "archive">,
        agents: createApiFixture<AgentApi>(
          {
            listWorkflowConfigs: async () => [{ id: "agent_1", config: {} }],
            archive: async (input) => {
              calls.push(`agent ${input.id}`);
              return createApiFixture({}, "Agent");
            },
          },
          "AgentApi",
        ),
      });

      const result = await service.cascadeArchive({
        projectId: "project_1",
        workflowId: "workflow_1",
      });

      expect(calls).toEqual(["agent agent_1", "workflow workflow_1"]);
      expect(result).toEqual({ workflow: archivedWorkflow, archivedAgentsCount: 1 });
    });
  });
});
