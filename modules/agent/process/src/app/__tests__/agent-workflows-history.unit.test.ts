import { describe, expect, it, vi } from "vitest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { AuditLogApi, AuditLogHistoryEntry } from "@langwatch/audit-log-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { ProjectNotFoundError, type ProjectApi } from "@langwatch/project-contract";
import { createLogger } from "@langwatch/observability";
import { agentWorkflowCopyFixture, createAgentAppFixture } from "./agent.fixture.ts";

const reference = { id: "agent_1", projectId: "project_1" };
const workflowAgent = {
  ...reference,
  name: "Answerer",
  type: "workflow" as const,
  config: { workflow_id: "workflow_1" },
  workflowId: "workflow_1",
};
const copyInput = {
  sourceAgentId: reference.id,
  sourceProjectId: reference.projectId,
  targetProjectId: "project_2",
  actorUserId: "user_1",
};

describe("AgentApp workflow and audit ownership", () => {
  it("refuses to fabricate a navigation path when a copy's project is missing", async () => {
    const { app, repositories } = createAgentAppFixture({
      projects: createApiFixture<ProjectApi>({ listPaths: async () => [] }),
    });
    await repositories.agents.create({
      id: "copy_1",
      projectId: "missing_project",
      name: "Copy",
      type: "signature",
      config: { prompt: "hello" },
      copiedFromAgentId: "source_1",
    });

    await expect(app.getCopies({ sourceAgentId: "source_1" })).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  /** @scenario "Workflow fields describe the current graph" */
  it("maps workflow field metadata into an Agent view", async () => {
    const listFields = vi.fn(async () => ({
      workflow_1: {
        fieldsResolved: true,
        inputFields: [{ identifier: "question", type: "str" as const }],
        outputFields: [
          { identifier: "answer", type: "str" as const },
          { identifier: "score", type: "float" as const },
        ],
      },
    }));
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({ listFields }),
    });
    await repositories.agents.create(workflowAgent);

    expect(await app.getById(reference)).toMatchObject({
      fieldsResolved: true,
      inputFields: [{ identifier: "question", type: "str" }],
      outputFields: [
        { identifier: "answer", type: "str" },
        { identifier: "score", type: "float" },
      ],
    });
    expect(listFields).toHaveBeenCalledWith({
      projectId: reference.projectId,
      workflowIds: ["workflow_1"],
    });
  });

  it.each(["archived", "malformed"])(
    "keeps an Agent readable when its %s graph resolves no fields",
    async () => {
      const { app, repositories } = createAgentAppFixture({
        workflows: createApiFixture<WorkflowApi>({ listFields: async () => ({}) }),
      });
      await repositories.agents.create(workflowAgent);

      expect(await app.getById(reference)).toMatchObject({
        fieldsResolved: false,
        inputFields: [],
        outputFields: [],
      });
    },
  );

  it("returns the related Workflow identity", async () => {
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({
        listSummaries: async () => [{ id: "workflow_1", name: "Answering workflow" }],
      }),
    });
    await repositories.agents.create(workflowAgent);

    expect(await app.relatedEntities(reference)).toEqual({
      workflow: { id: "workflow_1", name: "Answering workflow" },
    });
  });

  it("scopes the related Workflow query and preserves an absent summary", async () => {
    const listSummaries = vi.fn(async () => []);
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({ listSummaries }),
    });
    await repositories.agents.create(workflowAgent);

    expect(await app.relatedEntities(reference)).toEqual({ workflow: null });
    expect(listSummaries).toHaveBeenCalledWith({
      projectId: reference.projectId,
      workflowIds: ["workflow_1"],
    });
  });

  /** @scenario "Cascade archive uses the workflow owner" */
  it("archives the linked graph and Agent together", async () => {
    const archiveLinked = vi.fn(async () => ({ id: "workflow_1" }));
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({ archiveLinked }),
    });
    await repositories.agents.create(workflowAgent);

    const result = await app.cascadeArchive(reference);

    expect(result.archivedWorkflow).toEqual({ id: "workflow_1" });
    expect(result.agent.archivedAt).toBeInstanceOf(Date);
    expect((await repositories.agents.getByIdIncludingArchived(reference)).archivedAt).toEqual(
      result.agent.archivedAt,
    );
    expect(archiveLinked).toHaveBeenCalledWith({
      workflowId: "workflow_1",
      projectId: reference.projectId,
    });
  });

  async function history() {
    const listEntityHistory = vi.fn(async (): Promise<AuditLogHistoryEntry[]> => [
      {
        id: "entry_new",
        action: "agents.update",
        createdAt: new Date("2026-08-02"),
        userId: "user_1",
        args: { id: reference.id },
      },
      {
        id: "entry_old",
        action: "agents.create",
        createdAt: new Date("2026-08-01"),
        userId: null,
        args: { agentId: reference.id },
      },
      {
        id: "entry_copy",
        action: "agents.copy",
        createdAt: new Date("2026-07-31"),
        userId: "user_gone",
        args: { newAgentId: reference.id },
      },
    ]);
    const getProfiles = vi.fn(async () => [
      {
        id: "user_1",
        name: "Alex",
        email: "alex@langwatch.ai",
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastLoginAt: null,
        deactivatedAt: null,
        lastHomePath: null,
        tracesExplorerTourDismissedAt: null,
      },
    ]);
    const fixture = createAgentAppFixture({
      auditLog: createApiFixture<AuditLogApi>({ listEntityHistory }),
      users: createApiFixture<UserApi>({ getProfiles }),
    });
    await fixture.repositories.agents.create({
      ...reference,
      name: "Answerer",
      type: "signature",
      config: {},
    });

    return { ...fixture, listEntityHistory, getProfiles };
  }

  /** @scenario "History is scoped and enriched by its owners" */
  it("preserves history order and attaches author profiles in one batch", async () => {
    const { app, getProfiles } = await history();
    const entries = await app.getHistory({ agentId: reference.id, projectId: reference.projectId });

    expect(entries.map((entry) => entry.id)).toEqual(["entry_new", "entry_old", "entry_copy"]);
    expect(entries[0]?.user).toEqual({ id: "user_1", name: "Alex", email: "alex@langwatch.ai" });
    expect(getProfiles).toHaveBeenCalledWith({ userIds: ["user_1", "user_gone"] });
  });

  /** @scenario "History is scoped and enriched by its owners" */
  it("returns no author for unattributed or deleted-user history", async () => {
    const { app } = await history();
    const entries = await app.getHistory({ agentId: reference.id, projectId: reference.projectId });

    expect(entries[1]?.user).toBeNull();
    expect(entries[2]?.user).toBeNull();
  });

  /** @scenario "History is scoped and enriched by its owners" */
  it("requests only the named Agent, project and action family from AuditLog", async () => {
    const { app, listEntityHistory } = await history();
    await app.getHistory({ agentId: reference.id, projectId: reference.projectId });

    expect(listEntityHistory).toHaveBeenCalledWith({
      projectId: reference.projectId,
      entityId: reference.id,
      actionPrefix: "agents.",
      argumentNames: ["id", "agentId", "newAgentId"],
      limit: 100,
    });
    listEntityHistory.mockClear();
    await expect(
      app.getHistory({ agentId: reference.id, projectId: "other_project" }),
    ).rejects.toMatchObject({ code: "agent_not_found" });
    expect(listEntityHistory).not.toHaveBeenCalled();
  });

  it("copies a signature Agent without requesting Workflow work", async () => {
    const { app, repositories } = createAgentAppFixture();
    await repositories.agents.create({
      ...reference,
      name: "Answerer",
      type: "signature",
      config: {},
    });

    const copied = await app.copy(copyInput);

    expect(copied).toMatchObject({ projectId: "project_2", copiedFromAgentId: reference.id });
    expect(
      await repositories.agents.getById({ id: copied.id, projectId: "project_2" }),
    ).toMatchObject({ type: "signature", workflowId: null });
  });

  it("fails before persistence when its Workflow dependency refuses a copy", async () => {
    const failure = new Error("Workflow copying unavailable");
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({
        copy: async () => {
          throw failure;
        },
      }),
    });
    await repositories.agents.create(workflowAgent);

    await expect(app.copy(copyInput)).rejects.toBe(failure);
    expect(await repositories.agents.findAll({ projectId: "project_2" })).toEqual([]);
  });

  /** @scenario "A workflow copy owns its copied graph" */
  it("points a copied Agent at the Workflow copy returned by its owner", async () => {
    const copy = vi.fn(async () => agentWorkflowCopyFixture());
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({ copy }),
    });
    await repositories.agents.create(workflowAgent);
    const source = await repositories.agents.getById(reference);

    const result = await app.copy(copyInput);

    expect(copy).toHaveBeenCalledWith(
      {
        sourceWorkflowId: "workflow_1",
        sourceProjectId: "project_1",
        targetProjectId: "project_2",
        copiedFromWorkflowId: "workflow_1",
        authorId: "user_1",
      },
      { id: "user_1" },
    );
    expect(
      await repositories.agents.getById({ id: result.id, projectId: "project_2" }),
    ).toMatchObject({ workflowId: "workflow_copy", copiedFromAgentId: reference.id });
    expect(await repositories.agents.getById(reference)).toEqual(source);
  });

  /** @scenario "Failed persistence compensates the graph copy" */
  it("requests copied Workflow cleanup while preserving the original Agent write error", async () => {
    const deleteUncommitted = vi.fn(async () => {});
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({
        copy: async () => agentWorkflowCopyFixture(),
        deleteUncommitted,
      }),
    });
    await repositories.agents.create(workflowAgent);
    const failure = new Error("agent row rejected");
    vi.spyOn(repositories.agents, "create").mockRejectedValueOnce(failure);

    await expect(app.copy(copyInput)).rejects.toBe(failure);
    expect(deleteUncommitted).toHaveBeenCalledWith({
      workflowId: "workflow_copy",
      projectId: "project_2",
    });
    expect(await repositories.agents.findAll({ projectId: "project_2" })).toEqual([]);
  });

  /** @scenario "Failed persistence compensates the graph copy" */
  it("logs a failed graph cleanup without replacing the original persistence failure", async () => {
    const rollbackError = new Error("workflow cleanup refused");
    const { app, repositories } = createAgentAppFixture({
      workflows: createApiFixture<WorkflowApi>({
        copy: async () => agentWorkflowCopyFixture(),
        deleteUncommitted: async () => {
          throw rollbackError;
        },
      }),
    });
    await repositories.agents.create(workflowAgent);
    const failure = new Error("agent row rejected");
    vi.spyOn(repositories.agents, "create").mockRejectedValueOnce(failure);
    const logged = vi
      .spyOn(createLogger("langwatch:agent:copy"), "error")
      .mockImplementation(() => {});
    try {
      await expect(app.copy(copyInput)).rejects.toBe(failure);
      expect(logged).toHaveBeenCalledWith(
        { error: rollbackError, workflowId: "workflow_copy" },
        "Failed to remove uncommitted workflow copy",
      );
      expect(await repositories.agents.findAll({ projectId: "project_2" })).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });
});
