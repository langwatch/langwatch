/**
 * @vitest-environment node
 * @see modules/workflow/specs/workflow-service.feature
 */
import {
  AgentDeployedLabelProtectedError,
  type AgentApi,
  type AgentOverview,
} from "@langwatch/agent-contract";
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
            getById: async () => createApiFixture<AgentOverview>({ labels: [] }, "AgentOverview"),
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
        by: { id: "user_ada" },
      });

      expect(calls).toEqual(["agent agent_1", "workflow workflow_1"]);
      expect(result).toEqual({ workflow: archivedWorkflow, archivedAgentsCount: 1 });
    });
  });

  describe("when one of its agents is deployed and the caller may not deploy", () => {
    /** @scenario "Archiving a workflow refuses a deployed agent the caller may not undeploy" */
    it("asks the deploy check for the deployed agent first and archives nothing", async () => {
      const archived: string[] = [];
      const callers: unknown[] = [];
      const service = WorkflowLinkedRowsService.create({
        workflows: {
          archive: async (input) => {
            archived.push(`workflow ${input.id}`);
            return archivedWorkflow;
          },
        } satisfies Pick<WorkflowService, "archive">,
        agents: createApiFixture<AgentApi>(
          {
            listWorkflowConfigs: async () => [
              { id: "agent_plain", config: {} },
              { id: "agent_deployed", config: {} },
            ],
            getById: async ({ id }) =>
              createApiFixture<AgentOverview>(
                { labels: id === "agent_deployed" ? [{ label: "production", version: 1 }] : [] },
                "AgentOverview",
              ),
            archive: async (input) => {
              callers.push(input.caller);
              if (input.id === "agent_deployed") {
                throw new AgentDeployedLabelProtectedError({
                  agentId: input.id,
                  labels: ["production"],
                });
              }
              archived.push(`agent ${input.id}`);
              return createApiFixture({}, "Agent");
            },
          },
          "AgentApi",
        ),
      });

      await expect(
        service.cascadeArchive({
          projectId: "project_1",
          workflowId: "workflow_1",
          by: { id: "user_grace" },
        }),
      ).rejects.toMatchObject({ code: "agent_deployed_label_protected" });
      expect(archived).toEqual([]);
      expect(callers).toEqual([{ type: "user", id: "user_grace" }]);
    });
  });
});
