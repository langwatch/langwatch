/**
 * @vitest-environment node
 * @see packages/features/agent/specs/package-boundary.feature
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PrismaAgentAdapter } from "../../adapters/prisma.agent.adapter.ts";
import type { AgentsDatabase, AgentsWorkflowPort } from "../../ports/agent.port.ts";

function workflowAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent_workflow",
    projectId: "project_1",
    name: "Studio agent",
    type: "workflow",
    config: { workflow_id: "workflow_1" },
    workflowId: "workflow_1",
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function setup() {
  const workflows = {
    fields: vi.fn(async () => ({})),
    related: vi.fn(async () => null),
    copy: vi.fn(async () => ({ workflowId: "workflow_copy" })),
    archive: vi.fn(async ({ workflowId }: { workflowId: string }) => ({ id: workflowId })),
    remove: vi.fn(async () => undefined),
  } satisfies AgentsWorkflowPort;

  const database = {
    agent: {
      findFirst: vi.fn(async () => workflowAgentRow()),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => workflowAgentRow(data)),
      update: vi.fn(async () => workflowAgentRow()),
    },
    user: { findMany: vi.fn(async () => []) },
  } as unknown as AgentsDatabase;

  return {
    workflows,
    database,
    service: PrismaAgentAdapter.create({
      database,
      workflows,
      auditLog: { history: async () => [] },
      generateId: () => "agent_copy",
    }),
  };
}

describe("given an agent operation that reaches a linked workflow", () => {
  describe("when the Agents service performs it", () => {
    /** @scenario "Linked workflow behaviour uses an injected capability" */
    it("reads, copies and archives the workflow through the injected capability alone", async () => {
      const { service, workflows } = setup();

      await service.relatedEntities({ id: "agent_workflow", projectId: "project_1" });
      expect(workflows.related).toHaveBeenCalledWith({
        projectId: "project_1",
        workflowId: "workflow_1",
      });

      await service.copy({
        sourceAgentId: "agent_workflow",
        sourceProjectId: "project_1",
        targetProjectId: "project_2",
        actorUserId: "user_1",
      });
      expect(workflows.copy).toHaveBeenCalledWith({
        workflowId: "workflow_1",
        sourceProjectId: "project_1",
        targetProjectId: "project_2",
        actorUserId: "user_1",
      });

      await service.cascadeArchive({ id: "agent_workflow", projectId: "project_1" });
      expect(workflows.archive).toHaveBeenCalledWith({
        workflowId: "workflow_1",
        projectId: "project_1",
      });

      const manifest = JSON.parse(
        readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
      ) as { dependencies?: Record<string, string> };
      const workflowDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) =>
        /workflow/.test(name),
      );
      expect(workflowDependencies).not.toContain("@langwatch/workflow-server");
      expect(workflowDependencies.every((name) => name.endsWith("-contract"))).toBe(true);
    });

    it("removes a workflow it copied when persisting the agent copy fails", async () => {
      const { service, workflows, database } = setup();
      vi.mocked(database.agent.create).mockRejectedValueOnce(new Error("write refused"));

      await expect(
        service.copy({
          sourceAgentId: "agent_workflow",
          sourceProjectId: "project_1",
          targetProjectId: "project_2",
          actorUserId: "user_1",
        }),
      ).rejects.toThrow();

      expect(workflows.remove).toHaveBeenCalledWith({
        workflowId: "workflow_copy",
        projectId: "project_2",
      });
    });
  });
});
