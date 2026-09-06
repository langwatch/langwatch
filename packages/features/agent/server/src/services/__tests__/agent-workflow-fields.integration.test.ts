/**
 * A workflow agent's fields come from its linked Studio graph, not from its own
 * config, so they are resolved against real rows on every read.
 * @see specs/experiments-v3/workflow-agent-target-fields.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAgentAdapter } from "../../adapters/postgres.agent.adapter";

/** This suite writes and reads its own rows, so it composes no tenant guard. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

type EndResult = { identifier: string; type: string };

const DB_URL = process.env.DATABASE_URL;
const suffix = nanoid(8);
const ORGANIZATION_ID = `org_agent_fields_${suffix}`;
const TEAM_ID = `team_agent_fields_${suffix}`;
const PROJECT_ID = `proj_agent_fields_${suffix}`;

const connection = DB_URL
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }),
    )
  : null;

const database = (): PrismaClient => {
  if (!connection) throw new Error("DATABASE_URL is required for the agent field suite");

  return connection.client;
};

const agents = () => PostgresAgentAdapter.create({ database: database() }).build();

const dslWith = (endResults: EndResult[]) => ({
  spec_version: "1.4",
  name: "workflow agent graph",
  icon: "🤖",
  description: "Test workflow",
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
      data: { name: "End", inputs: endResults },
    },
  ],
  edges: [
    {
      id: "e1",
      source: "entry",
      sourceHandle: "outputs.question",
      target: "end",
      targetHandle: "inputs.question",
    },
  ],
  state: {},
});

const workflowIds: string[] = [];
const agentIds: string[] = [];
let authorId = "";

const commitVersion = async ({
  workflowId,
  endResults,
}: {
  workflowId: string;
  endResults: EndResult[];
}): Promise<void> => {
  const version = await database().workflowVersion.create({
    data: {
      id: `wfv_${nanoid(8)}`,
      workflowId,
      projectId: PROJECT_ID,
      version: `${Date.now()}`,
      commitMessage: "test",
      authorId,
      dsl: dslWith(endResults),
    },
  });
  await database().workflow.update({
    where: { id: workflowId },
    data: { currentVersionId: version.id, latestVersionId: version.id },
  });
};

/** A workflow agent over a graph declaring the given results, on real rows. */
const createWorkflowAgent = async (
  endResults: EndResult[],
): Promise<{ agentId: string; workflowId: string }> => {
  const workflowId = `wf_${nanoid(8)}`;
  await database().workflow.create({
    data: {
      id: workflowId,
      projectId: PROJECT_ID,
      name: "workflow agent graph",
      icon: "🤖",
      description: "Test workflow",
    },
  });
  workflowIds.push(workflowId);
  await commitVersion({ workflowId, endResults });

  const agent = await agents().create({
    id: `agent_${nanoid(8)}`,
    projectId: PROJECT_ID,
    name: "workflow agent",
    type: "workflow",
    config: { name: "workflow agent", isCustom: true, workflow_id: workflowId },
    workflowId,
  });
  agentIds.push(agent.id);

  return { agentId: agent.id, workflowId };
};

describe.skipIf(!DB_URL)("a workflow agent's fields", () => {
  beforeAll(async () => {
    const db = database();
    await db.organization.create({
      data: { id: ORGANIZATION_ID, name: ORGANIZATION_ID, slug: ORGANIZATION_ID },
    });
    await db.team.create({
      data: { id: TEAM_ID, name: TEAM_ID, slug: TEAM_ID, organizationId: ORGANIZATION_ID },
    });
    await db.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "typescript",
        framework: "other",
        apiKey: `key-${PROJECT_ID}`,
      },
    });
    const user = await db.user.create({
      data: { id: `user_${suffix}`, email: `${PROJECT_ID}@example.com` },
    });
    authorId = user.id;
  });

  afterAll(async () => {
    try {
      const db = database();
      // The version relations are enforced even under relationMode "prisma", so
      // a workflow still pointing at its versions cannot be deleted.
      await db.workflow.updateMany({
        where: { id: { in: workflowIds }, projectId: PROJECT_ID },
        data: { currentVersionId: null, latestVersionId: null },
      });
      // Child rows first: every relation below is enforced, so a parent
      // deleted early fails the whole teardown on a constraint.
      await db.agent.deleteMany({ where: { id: { in: agentIds }, projectId: PROJECT_ID } });
      await db.workflowVersion.deleteMany({
        where: { workflowId: { in: workflowIds }, projectId: PROJECT_ID },
      });
      await db.workflow.deleteMany({ where: { id: { in: workflowIds }, projectId: PROJECT_ID } });
      await db.project.deleteMany({ where: { id: PROJECT_ID } });
      await db.user.deleteMany({ where: { id: authorId } });
      await db.team.deleteMany({ where: { id: TEAM_ID } });
      await db.organization.deleteMany({ where: { id: ORGANIZATION_ID } });
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given a workflow whose end node declares two results", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent reports the end node's results as its output fields" */
      it("reports both results, keeping the declared object type", async () => {
        const { agentId } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);

        const read = await agents().getById({ id: agentId, projectId: PROJECT_ID });

        expect(read.outputFields).toEqual([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);
      });

      /** @scenario "A workflow agent reports the entry node's fields as its input fields" */
      it("reports the entry node's fields as its inputs", async () => {
        const { agentId } = await createWorkflowAgent([{ identifier: "output", type: "str" }]);

        const read = await agents().getById({ id: agentId, projectId: PROJECT_ID });

        expect(read.inputFields).toEqual([{ identifier: "question", type: "str" }]);
      });

      it("reports the same fields when the project lists every agent", async () => {
        const { agentId } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);

        const listed = (await agents().getAll({ projectId: PROJECT_ID })).find(
          (agent) => agent.id === agentId,
        );

        expect(listed?.outputFields).toEqual([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);
      });
    });
  });

  describe("given the workflow gains a result after the agent was created", () => {
    describe("when the agent is read again", () => {
      /** @scenario "Editing the workflow changes the agent's fields without touching the agent" */
      it("reports the new result, with the agent row untouched", async () => {
        const { agentId, workflowId } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);
        const before = await agents().getById({ id: agentId, projectId: PROJECT_ID });
        expect(before.outputFields).toHaveLength(2);

        await commitVersion({
          workflowId,
          endResults: [
            { identifier: "output", type: "str" },
            { identifier: "chunks", type: "dict" },
            { identifier: "citations", type: "list" },
          ],
        });

        const after = await agents().getById({ id: agentId, projectId: PROJECT_ID });

        expect(after.outputFields.map((field) => field.identifier)).toEqual([
          "output",
          "chunks",
          "citations",
        ]);
        expect(after.updatedAt).toEqual(before.updatedAt);
      });
    });
  });

  describe("given a workflow that declares no results", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent whose workflow declares no results reports none" */
      it("reports no output fields, and says it resolved them", async () => {
        const { agentId } = await createWorkflowAgent([]);

        const read = await agents().getById({ id: agentId, projectId: PROJECT_ID });

        expect(read.outputFields).toEqual([]);
        expect(read.fieldsResolved).toBe(true);
      });
    });
  });

  describe("given the linked workflow was deleted, which archives it", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent whose workflow was deleted reports no fields" */
      it("still answers the agent, with no fields and none resolved", async () => {
        const { agentId, workflowId } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
        ]);
        await database().workflow.update({
          where: { id: workflowId, projectId: PROJECT_ID },
          data: { archivedAt: new Date() },
        });

        const read = await agents().getById({ id: agentId, projectId: PROJECT_ID });

        expect(read.id).toBe(agentId);
        expect(read.outputFields).toEqual([]);
        expect(read.inputFields).toEqual([]);
        expect(read.fieldsResolved).toBe(false);
      });
    });
  });

  describe("given the agent's workflow id matches no workflow in the project", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent pointing at no workflow at all reports no fields" */
      it("reports no fields and says it could not resolve them", async () => {
        const agent = await agents().create({
          id: `agent_${nanoid(8)}`,
          projectId: PROJECT_ID,
          name: "orphaned workflow agent",
          type: "workflow",
          config: { name: "orphaned workflow agent", isCustom: true, workflow_id: "wf_missing" },
          workflowId: "wf_missing",
        });
        agentIds.push(agent.id);

        const read = await agents().getById({ id: agent.id, projectId: PROJECT_ID });

        expect(read.id).toBe(agent.id);
        expect(read.outputFields).toEqual([]);
        expect(read.fieldsResolved).toBe(false);
      });
    });
  });
});
