import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { LinkedWorkflowCopyPort } from "../../ports/linked-workflow-copy.port";
import { PostgresAgentAdapter } from "../postgres.agent.adapter";

type Row = Record<string, unknown>;

/**
 * A graph whose entry node declares one input and whose end node declares two
 * results, so "the fields are the graph's" is observable rather than asserted
 * against an empty list.
 */
function graph(): Row {
  return {
    spec_version: "1.4",
    name: "Answerer",
    icon: "x",
    description: "x",
    version: "1.0",
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        data: { name: "Entry", outputs: [{ identifier: "question", type: "str" }] },
      },
      {
        id: "end",
        type: "end",
        position: { x: 1, y: 0 },
        data: {
          name: "End",
          inputs: [
            { identifier: "answer", type: "str" },
            { identifier: "score", type: "float" },
          ],
        },
      },
    ],
    edges: [],
    state: {},
  };
}

function agentRow(overrides: Row = {}): Row {
  return {
    id: "agent_1",
    projectId: "project_1",
    name: "Answerer",
    type: "signature",
    config: {
      prompt: "Answer clearly",
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [{ identifier: "answer", type: "str" }],
    },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function workflowAgentRow(overrides: Row = {}): Row {
  return agentRow({
    id: "agent_workflow",
    type: "workflow",
    config: { workflow_id: "workflow_1" },
    workflowId: "workflow_1",
    ...overrides,
  });
}

function workflowRow(overrides: Row = {}): Row {
  return {
    id: "workflow_1",
    projectId: "project_1",
    name: "Answering workflow",
    archivedAt: null,
    currentVersionId: "version_1",
    latestVersionId: "version_1",
    currentVersion: { id: "version_1", dsl: graph() },
    ...overrides,
  };
}

/** The `where` shapes these repositories actually send, and no others. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as Row[]).some((clause) => matches(row, clause));
    }
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (typeof condition === "object") {
      const test = condition as Row;
      if ("in" in test) return (test.in as unknown[]).includes(value);
      if ("startsWith" in test) {
        return typeof value === "string" && value.startsWith(test.startsWith as string);
      }
      if ("path" in test) {
        const [field] = test.path as string[];
        return (value as Row | null)?.[field!] === test.equals;
      }
      return false;
    }
    return value === condition;
  });
}

function project(row: Row, select: Row | undefined): Row {
  if (!select) return row;
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key] === true)
      .map((key) => [key, row[key]]),
  );
}

type Seed = {
  agents?: Row[];
  workflows?: Row[];
  versions?: Row[];
  auditLog?: Row[];
  users?: Row[];
};

function database(seed: Seed = {}) {
  const agents = seed.agents ?? [];
  const workflows = seed.workflows ?? [];
  const versions = seed.versions ?? [];
  const auditLog = seed.auditLog ?? [];
  const users = seed.users ?? [];

  const collection = (rows: Row[]) => ({
    findFirst: async ({ where, select }: { where?: Row; select?: Row } = {}) => {
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? project(row, select) : null;
    },
    findMany: async ({
      where,
      select,
      orderBy,
      take,
    }: { where?: Row; select?: Row; orderBy?: Row; take?: number } = {}) => {
      let found = rows.filter((row) => matches(row, where));
      if (orderBy && "createdAt" in orderBy) {
        found = [...found].sort(
          (left, right) => (right.createdAt as Date).getTime() - (left.createdAt as Date).getTime(),
        );
      }
      if (take !== undefined) found = found.slice(0, take);
      return found.map((row) => project(row, select));
    },
    count: async ({ where }: { where?: Row } = {}) =>
      rows.filter((row) => matches(row, where)).length,
    create: async ({ data }: { data: Row }) => {
      const row = { archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data, select }: { where: Row; data: Row; select?: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) throw new Error(`No row matched ${JSON.stringify(where)}`);
      Object.assign(row, data);
      return project(row, select);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const found = rows.filter((row) => matches(row, where));
      for (const row of found) Object.assign(row, data);
      return { count: found.length };
    },
    delete: async ({ where }: { where: Row }) => {
      const index = rows.findIndex((candidate) => matches(candidate, where));
      if (index < 0) throw new Error(`No row matched ${JSON.stringify(where)}`);
      return rows.splice(index, 1)[0]!;
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const kept = rows.filter((row) => !matches(row, where));
      const removed = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return { count: removed };
    },
  });

  const client = {
    agent: collection(agents),
    workflow: collection(workflows),
    workflowVersion: collection(versions),
    auditLog: collection(auditLog),
    user: collection(users),
  } as unknown as PrismaClient;

  return { client, agents, workflows, versions, auditLog, users };
}

class RecordingWorkflowCopies extends LinkedWorkflowCopyPort {
  readonly calls: unknown[] = [];

  copy(input: {
    workflowId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actorUserId: string;
  }): Promise<{ workflowId: string }> {
    this.calls.push(input);
    return Promise.resolve({ workflowId: `${input.workflowId}_copy` });
  }
}

describe("PostgresAgentAdapter", () => {
  describe("given an agent whose type is workflow", () => {
    /** @scenario "A workflow agent reports the fields of the graph it points at" */
    it("reports the linked graph's entry inputs and end results as its fields", async () => {
      const { client } = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow()],
      });
      const agents = PostgresAgentAdapter.create({ database: client }).build();

      const agent = await agents.getById({ id: "agent_workflow", projectId: "project_1" });

      expect(agent.fieldsResolved).toBe(true);
      expect(agent.inputFields).toEqual([{ identifier: "question", type: "str" }]);
      expect(agent.outputFields).toEqual([
        { identifier: "answer", type: "str" },
        { identifier: "score", type: "float" },
      ]);
    });

    /** @scenario "A workflow agent whose graph cannot be read reports no fields" */
    it("reports no fields, and says so, when the graph is archived", async () => {
      const { client } = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow({ archivedAt: new Date(0) })],
      });
      const agents = PostgresAgentAdapter.create({ database: client }).build();

      const agent = await agents.getById({ id: "agent_workflow", projectId: "project_1" });

      expect(agent).toMatchObject({
        fieldsResolved: false,
        inputFields: [],
        outputFields: [],
      });
    });

    /** @scenario "A workflow agent whose graph cannot be read reports no fields" */
    it("reports no fields for a stored graph today's schema cannot parse", async () => {
      const { client } = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow({ currentVersion: { id: "version_1", dsl: { nodes: "?" } } })],
      });
      const agents = PostgresAgentAdapter.create({ database: client }).build();

      const agent = await agents.getById({ id: "agent_workflow", projectId: "project_1" });

      expect(agent.fieldsResolved).toBe(false);
    });

    /** @scenario "The related entity of a workflow agent is its linked workflow" */
    it("answers with the linked workflow's identity", async () => {
      const { client } = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow()],
      });
      const agents = PostgresAgentAdapter.create({ database: client }).build();

      await expect(
        agents.relatedEntities({ id: "agent_workflow", projectId: "project_1" }),
      ).resolves.toEqual({ workflow: { id: "workflow_1", name: "Answering workflow" } });
    });

    /** @scenario "The related entity of a workflow agent is its linked workflow" */
    it("answers with nothing when the linked workflow belongs to another project", async () => {
      const { client } = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow({ projectId: "project_2" })],
      });
      const agents = PostgresAgentAdapter.create({ database: client }).build();

      await expect(
        agents.relatedEntities({ id: "agent_workflow", projectId: "project_1" }),
      ).resolves.toEqual({ workflow: null });
    });

    /** @scenario "Archiving a workflow agent archives the graph with it" */
    it("archives the linked graph alongside the agent", async () => {
      const seeded = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow()],
      });
      const agents = PostgresAgentAdapter.create({ database: seeded.client }).build();

      const result = await agents.cascadeArchive({
        id: "agent_workflow",
        projectId: "project_1",
      });

      expect(result.archivedWorkflow).toEqual({ id: "workflow_1" });
      expect(seeded.workflows[0]?.archivedAt).toBeInstanceOf(Date);
      expect(seeded.agents[0]?.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("given the project's audit log", () => {
    const history = () =>
      database({
        agents: [agentRow()],
        auditLog: [
          {
            id: "entry_new",
            action: "agents.update",
            createdAt: new Date("2026-08-02T00:00:00.000Z"),
            userId: "user_1",
            projectId: "project_1",
            args: { id: "agent_1" },
          },
          {
            id: "entry_old",
            action: "agents.create",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            userId: null,
            projectId: "project_1",
            args: { agentId: "agent_1" },
          },
          {
            id: "entry_copy",
            action: "agents.copy",
            createdAt: new Date("2026-07-31T00:00:00.000Z"),
            userId: "user_gone",
            projectId: "project_1",
            args: { newAgentId: "agent_1" },
          },
          {
            id: "entry_other_agent",
            action: "agents.update",
            createdAt: new Date("2026-08-03T00:00:00.000Z"),
            userId: "user_1",
            projectId: "project_1",
            args: { id: "agent_2" },
          },
          {
            id: "entry_other_project",
            action: "agents.update",
            createdAt: new Date("2026-08-04T00:00:00.000Z"),
            userId: "user_1",
            projectId: "project_2",
            args: { id: "agent_1" },
          },
          {
            id: "entry_not_an_agent_action",
            action: "prompts.update",
            createdAt: new Date("2026-08-05T00:00:00.000Z"),
            userId: "user_1",
            projectId: "project_1",
            args: { id: "agent_1" },
          },
        ],
        users: [{ id: "user_1", name: "Alex", email: "alex@langwatch.ai" }],
      });

    /** @scenario "An agent's history is the project's agent audit entries with their authors" */
    it("returns the newest entries first, each carrying the user who wrote it", async () => {
      const agents = PostgresAgentAdapter.create({ database: history().client }).build();

      const entries = await agents.getHistory({ agentId: "agent_1", projectId: "project_1" });

      expect(entries.map((entry) => entry.id)).toEqual(["entry_new", "entry_old", "entry_copy"]);
      expect(entries[0]?.user).toEqual({
        id: "user_1",
        name: "Alex",
        email: "alex@langwatch.ai",
      });
    });

    /** @scenario "An agent's history is the project's agent audit entries with their authors" */
    it("carries no user for an entry nobody, or nobody who still exists, wrote", async () => {
      const agents = PostgresAgentAdapter.create({ database: history().client }).build();

      const entries = await agents.getHistory({ agentId: "agent_1", projectId: "project_1" });

      expect(entries[1]?.user).toBeNull();
      expect(entries[2]?.user).toBeNull();
    });

    /** @scenario "History is scoped to the project and to the agent named" */
    it("leaves out other agents, other projects and other actions", async () => {
      const agents = PostgresAgentAdapter.create({ database: history().client }).build();

      const entries = await agents.getHistory({ agentId: "agent_1", projectId: "project_1" });

      expect(entries.map((entry) => entry.id)).not.toContain("entry_other_agent");
      expect(entries.map((entry) => entry.id)).not.toContain("entry_other_project");
      expect(entries.map((entry) => entry.id)).not.toContain("entry_not_an_agent_action");
    });
  });

  describe("given a process that composed no workflow-copy capability", () => {
    /** @scenario "Copying a non-workflow agent needs no Workflow application" */
    it("copies a signature agent without touching a workflow", async () => {
      const seeded = database({ agents: [agentRow()], workflows: [workflowRow()] });
      const agents = PostgresAgentAdapter.create({ database: seeded.client }).build();

      const copy = await agents.copy({
        sourceAgentId: "agent_1",
        sourceProjectId: "project_1",
        targetProjectId: "project_2",
        actorUserId: "user_1",
      });

      expect(copy).toMatchObject({ projectId: "project_2", copiedFromAgentId: "agent_1" });
      expect(seeded.workflows).toHaveLength(1);
    });

    /** @scenario "Copying a workflow agent without one refuses by name" */
    it("refuses a workflow agent's copy, naming the capability it does not hold", async () => {
      const seeded = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow()],
      });
      const agents = PostgresAgentAdapter.create({
        database: seeded.client,
        processName: "langwatch-api",
      }).build();

      await expect(
        agents.copy({
          sourceAgentId: "agent_workflow",
          sourceProjectId: "project_1",
          targetProjectId: "project_2",
          actorUserId: "user_1",
        }),
      ).rejects.toThrow(/langwatch-api composes no Workflow application/);
      expect(seeded.agents).toHaveLength(1);
    });
  });

  describe("given a process that composed a workflow-copy capability", () => {
    /** @scenario "A supplied capability is what a workflow-agent copy goes through" */
    it("copies the graph through it and points the new agent at the copy", async () => {
      const seeded = database({
        agents: [workflowAgentRow()],
        workflows: [workflowRow()],
      });
      const workflowCopies = new RecordingWorkflowCopies();
      const agents = PostgresAgentAdapter.create({
        database: seeded.client,
        workflowCopies,
      }).build();

      const copy = await agents.copy({
        sourceAgentId: "agent_workflow",
        sourceProjectId: "project_1",
        targetProjectId: "project_2",
        actorUserId: "user_1",
      });

      expect(workflowCopies.calls).toEqual([
        {
          workflowId: "workflow_1",
          sourceProjectId: "project_1",
          targetProjectId: "project_2",
          actorUserId: "user_1",
        },
      ]);
      const written = seeded.agents.find((row) => row.id === copy.id);
      expect(written).toMatchObject({ workflowId: "workflow_1_copy", projectId: "project_2" });
    });

    /** @scenario "A failed agent write takes the copied graph back out" */
    it("removes the copied graph when the agent row cannot be written", async () => {
      const seeded = database({
        agents: [workflowAgentRow()],
        workflows: [
          workflowRow(),
          workflowRow({
            id: "workflow_1_copy",
            projectId: "project_2",
            currentVersionId: "version_2",
            latestVersionId: "version_2",
          }),
        ],
        versions: [
          {
            id: "version_2",
            workflowId: "workflow_1_copy",
            projectId: "project_2",
            parentId: null,
          },
        ],
      });
      const failure = new Error("agent row rejected");
      seeded.client.agent.create = vi.fn(() => Promise.reject(failure)) as never;
      const agents = PostgresAgentAdapter.create({
        database: seeded.client,
        workflowCopies: new RecordingWorkflowCopies(),
      }).build();

      await expect(
        agents.copy({
          sourceAgentId: "agent_workflow",
          sourceProjectId: "project_1",
          targetProjectId: "project_2",
          actorUserId: "user_1",
        }),
      ).rejects.toBe(failure);
      expect(seeded.workflows.map((row) => row.id)).toEqual(["workflow_1"]);
      expect(seeded.versions).toHaveLength(0);
    });
  });
});
