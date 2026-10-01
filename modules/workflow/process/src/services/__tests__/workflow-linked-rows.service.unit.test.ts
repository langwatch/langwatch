/**
 * @vitest-environment node
 * @see modules/workflow/specs/workflow-service.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { Evaluator, EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
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

const evaluator: Evaluator = {
  id: "evaluator_1",
  projectId: "project_1",
  name: "Quality check",
  slug: null,
  type: "workflow",
  config: {},
  workflowId: "workflow_1",
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

describe("the workflow's linked rows", () => {
  describe("when a workflow backing an evaluator, a monitor and an agent is archived", () => {
    /** @scenario "Archiving a workflow takes its evaluators, agents and monitors with it" */
    it("deletes the monitor, archives the evaluator and the agent, then the workflow", async () => {
      const calls: string[] = [];
      const service = WorkflowLinkedRowsService.create({
        workflows: {
          archive: async (input) => {
            calls.push(`workflow ${input.id}`);
            return archivedWorkflow;
          },
        } satisfies Pick<WorkflowService, "archive">,
        evaluators: createApiFixture<EvaluatorApi>(
          {
            listByWorkflow: async () => [evaluator],
            archive: async (input) => {
              calls.push(`evaluator ${input.id}`);
              return evaluator;
            },
          },
          "EvaluatorApi",
        ),
        monitors: createApiFixture<MonitorApi>(
          {
            findByEvaluator: async () => [{ id: "monitor_1", name: "Online check" }],
            delete: async (input) => {
              calls.push(`monitor ${input.id}`);
              return { success: true };
            },
          },
          "MonitorApi",
        ),
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

      expect(calls).toEqual([
        "monitor monitor_1",
        "evaluator evaluator_1",
        "agent agent_1",
        "workflow workflow_1",
      ]);
      expect(result).toEqual({
        workflow: archivedWorkflow,
        archivedEvaluatorsCount: 1,
        archivedAgentsCount: 1,
        deletedMonitorsCount: 1,
      });
    });
  });
});
