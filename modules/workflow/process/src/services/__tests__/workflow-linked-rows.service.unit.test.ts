/**
 * @vitest-environment node
 * @see modules/workflow/specs/workflow-service.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { MonitorApi, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Workflow } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { WorkflowLinkedRowsService } from "../workflow-linked-rows.service.ts";
import type { WorkflowService } from "../workflow.service.ts";

const NOW = new Date("2026-09-28T00:00:00.000Z");

type BackingEvaluator = NonNullable<MonitorWithEvaluator["evaluator"]>;

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
        monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
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

  describe("when the archive preview names the monitors that go", () => {
    /** @scenario "Archiving a workflow takes its agents with it, and its evaluators and monitors after a lag" */
    it("names only the monitors this workflow's live evaluators back", async () => {
      const backedBy = (id: string, workflowId: string, archivedAt: Date | null = null) =>
        createApiFixture<BackingEvaluator>({ id, workflowId, archivedAt }, "Evaluator");
      const monitor = (id: string, name: string, evaluator: BackingEvaluator | null) =>
        createApiFixture<MonitorWithEvaluator>({ id, name, evaluator }, "MonitorWithEvaluator");
      const service = WorkflowLinkedRowsService.create({
        workflows: createApiFixture<Pick<WorkflowService, "archive">>({}, "WorkflowService"),
        agents: createApiFixture<AgentApi>({}, "AgentApi"),
        monitors: createApiFixture<MonitorApi>(
          {
            list: async () => [
              monitor("monitor_1", "Nightly relevance", backedBy("evaluator_1", "workflow_1")),
              monitor("monitor_2", "Other workflow", backedBy("evaluator_2", "workflow_2")),
              monitor(
                "monitor_3",
                "Archived evaluator",
                backedBy("evaluator_3", "workflow_1", NOW),
              ),
              monitor("monitor_4", "No evaluator", null),
            ],
          },
          "MonitorApi",
        ),
      });

      const monitors = await service.listMonitors({
        projectId: "project_1",
        workflowId: "workflow_1",
      });

      expect(monitors).toEqual([
        { id: "monitor_1", name: "Nightly relevance", evaluatorId: "evaluator_1" },
      ]);
    });
  });
});
