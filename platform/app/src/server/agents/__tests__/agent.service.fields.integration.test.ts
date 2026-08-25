/**
 * A workflow agent's fields come from its linked Studio workflow, not from its
 * own config, so they are resolved against the real database on every read.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { AgentsFeature } from "~/runtime/app/features/agents";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestProject, getTestUser } from "~/utils/testUtils";

type EndResult = { identifier: string; type: string };

describe("AgentService field derivation", () => {
  let projectId: string;
  let authorId: string;
  const cleanupAgentIds: string[] = [];
  const cleanupWorkflowIds: string[] = [];

  beforeAll(async () => {
    const project = await getTestProject("agent-fields");
    projectId = project.id;
    const user = await getTestUser();
    authorId = user.id;
  });

  afterAll(async () => {
    // Prisma enforces the version relations even with relationMode "prisma",
    // so a workflow still pointing at its versions cannot be deleted.
    if (cleanupWorkflowIds.length > 0 && projectId) {
      await prisma.workflow.updateMany({
        where: { id: { in: cleanupWorkflowIds }, projectId },
        data: { currentVersionId: null, latestVersionId: null },
      });
    }

    await cleanupTestRows(prisma, [
      ["agent", { id: { in: cleanupAgentIds }, projectId }],
      ["workflowVersion", { workflowId: { in: cleanupWorkflowIds }, projectId }],
      ["workflow", { id: { in: cleanupWorkflowIds }, projectId }],
    ]);
  });

  const dslWith = (endResults: EndResult[]) => ({
    nodes: [
      {
        id: "entry",
        type: "entry",
        data: { outputs: [{ identifier: "question", type: "str" }] },
      },
      { id: "code", type: "code", data: {} },
      { id: "end", type: "end", data: { inputs: endResults } },
    ],
    edges: [
      {
        id: "e1",
        source: "entry",
        sourceHandle: "outputs.question",
        target: "code",
        targetHandle: "inputs.input",
      },
    ],
  });

  const commitVersion = async ({
    workflowId,
    endResults,
  }: {
    workflowId: string;
    endResults: EndResult[];
  }) => {
    const version = await prisma.workflowVersion.create({
      data: {
        id: `test_wfv_${nanoid(8)}`,
        workflowId,
        projectId,
        version: `${Date.now()}`,
        commitMessage: "test",
        authorId,
        dsl: dslWith(endResults),
      },
    });
    await prisma.workflow.update({
      where: { id: workflowId },
      data: { currentVersionId: version.id, latestVersionId: version.id },
    });
    return version.id;
  };

  const createWorkflowAgent = async (endResults: EndResult[]) => {
    const workflowId = `test_wf_${nanoid(8)}`;
    await prisma.workflow.create({
      data: {
        id: workflowId,
        projectId,
        name: "wf agent workflow",
        icon: "🤖",
        description: "Test workflow",
      },
    });
    cleanupWorkflowIds.push(workflowId);
    await commitVersion({ workflowId, endResults });

    const service = AgentsFeature.create({ prisma, session: null });
    const agent = await service.create({
      id: `test_agent_${nanoid(8)}`,
      projectId,
      name: "wf agent",
      type: "workflow",
      config: { name: "wf agent", isCustom: true, workflow_id: workflowId },
      workflowId,
    });
    cleanupAgentIds.push(agent.id);
    return { agent, workflowId, service };
  };

  describe("given a workflow agent whose end node declares two results", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent reports the end node's results as its output fields" */
      it("reports both results, keeping the declared object type", async () => {
        const { agent, service } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);

        const read = await service.getById({ id: agent.id, projectId });

        expect(read?.outputFields).toEqual([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);
      });

      /** @scenario "A workflow agent reports the entry node's fields as its input fields" */
      it("reports the entry node's fields as its inputs", async () => {
        const { agent, service } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
        ]);

        const read = await service.getById({ id: agent.id, projectId });

        expect(read?.inputFields).toEqual([{ identifier: "question", type: "str" }]);
      });

      it("reports the same fields when listing every agent in the project", async () => {
        const { agent, service } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);

        const all = await service.getAll({ projectId });
        const listed = all.find((a) => a.id === agent.id);

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
      it("reports the new result without the agent row being touched", async () => {
        const { agent, workflowId, service } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
          { identifier: "chunks", type: "dict" },
        ]);
        const before = await service.getById({ id: agent.id, projectId });
        expect(before?.outputFields).toHaveLength(2);
        const updatedAtBefore = before?.updatedAt;

        await commitVersion({
          workflowId,
          endResults: [
            { identifier: "output", type: "str" },
            { identifier: "chunks", type: "dict" },
            { identifier: "citations", type: "list" },
          ],
        });

        const after = await service.getById({ id: agent.id, projectId });
        expect(after?.outputFields.map((f) => f.identifier)).toEqual([
          "output",
          "chunks",
          "citations",
        ]);
        expect(after?.updatedAt).toEqual(updatedAtBefore);
      });
    });
  });

  describe("given a workflow that declares no results", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent whose workflow declares no results reports none" */
      it("reports no output fields rather than inventing one named output", async () => {
        const { agent, service } = await createWorkflowAgent([]);

        const read = await service.getById({ id: agent.id, projectId });

        expect(read?.outputFields).toEqual([]);
      });

      /** @scenario "A workflow agent whose workflow declares no results reports none" */
      it("marks the fields resolved, so an empty list is an answer", async () => {
        const { agent, service } = await createWorkflowAgent([]);

        const read = await service.getById({ id: agent.id, projectId });

        expect(read?.fieldsResolved).toBe(true);
      });
    });
  });

  // Deleting a workflow archives it: the delete endpoint sets archivedAt and
  // the row stays, so this is the shape a deleted workflow really leaves
  // behind. A workflow id matching no row at all is covered separately below.
  describe("given the linked workflow was deleted", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent whose workflow was deleted reports no fields" */
      it("still returns the agent, with no fields", async () => {
        const { agent, workflowId, service } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
        ]);
        await prisma.workflow.update({
          where: { id: workflowId, projectId },
          data: { archivedAt: new Date() },
        });

        const read = await service.getById({ id: agent.id, projectId });

        expect(read?.id).toBe(agent.id);
        expect(read?.outputFields).toEqual([]);
        expect(read?.inputFields).toEqual([]);
      });

      /** @scenario "A workflow agent whose workflow was deleted reports no fields" */
      it("marks the fields unresolved, so no caller mistakes it for an empty workflow", async () => {
        const { agent, workflowId, service } = await createWorkflowAgent([
          { identifier: "output", type: "str" },
        ]);
        await prisma.workflow.update({
          where: { id: workflowId, projectId },
          data: { archivedAt: new Date() },
        });

        const read = await service.getById({ id: agent.id, projectId });

        expect(read?.fieldsResolved).toBe(false);
      });
    });
  });

  describe("given the agent points at a workflow that has no row", () => {
    describe("when the agent is read", () => {
      /** @scenario "A workflow agent pointing at no workflow at all reports no fields" */
      it("reports no fields and says it could not resolve them", async () => {
        const service = AgentsFeature.create({ prisma, session: null });
        const agent = await service.create({
          id: `test_agent_${nanoid(8)}`,
          projectId,
          name: "wf agent",
          type: "workflow",
          config: {
            name: "wf agent",
            isCustom: true,
            workflow_id: "test_wf_missing",
          },
          workflowId: "test_wf_missing",
        });
        cleanupAgentIds.push(agent.id);

        const read = await service.getById({ id: agent.id, projectId });

        expect(read?.id).toBe(agent.id);
        expect(read?.outputFields).toEqual([]);
        expect(read?.fieldsResolved).toBe(false);
      });
    });
  });
});
