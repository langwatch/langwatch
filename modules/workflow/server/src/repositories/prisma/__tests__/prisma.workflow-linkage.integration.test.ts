import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkflowDslService } from "../../../services/workflow-dsl.service.ts";
import { PrismaWorkflowRepository } from "../prisma.workflow.repository.ts";

class TestQueryGuard extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor) {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const suffix = nanoid(8);
const projectId = `project_workflow_fields_${suffix}`;
const organizationId = `org_workflow_fields_${suffix}`;
const teamId = `team_workflow_fields_${suffix}`;
const authorId = `user_workflow_fields_${suffix}`;
const workflowIds: string[] = [];
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new TestQueryGuard() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database() {
  if (!connection) throw new Error("DATABASE_URL is required for workflow integration tests");
  return connection.client;
}

function repository() {
  return PrismaWorkflowRepository.create(database());
}

async function commitVersion(workflowId: string, results: { identifier: string; type: string }[]) {
  const version = await database().workflowVersion.create({
    data: {
      id: `version_${nanoid()}`,
      workflowId,
      projectId,
      authorId,
      version: nanoid(),
      commitMessage: "test",
      dsl: {
        spec_version: "1.4",
        name: "Graph",
        icon: "x",
        description: "Graph",
        version: "1.0",
        state: {},
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
            data: { name: "End", inputs: results },
          },
        ],
        edges: [
          {
            id: "edge",
            source: "entry",
            sourceHandle: "outputs.question",
            target: "end",
            targetHandle: "inputs.question",
          },
        ],
      },
    },
  });
  await database().workflow.update({
    where: { id: workflowId, projectId },
    data: { currentVersionId: version.id, latestVersionId: version.id },
  });
  return version;
}

async function createWorkflow(results: { identifier: string; type: string }[]) {
  const id = `workflow_${nanoid()}`;
  await database().workflow.create({
    data: { id, projectId, name: "Graph", icon: "x", description: "Graph" },
  });
  workflowIds.push(id);
  await commitVersion(id, results);
  return id;
}

async function fields(ids: string[]) {
  const sources = await repository().listFieldSources({ projectId, workflowIds: ids });
  const dsl = WorkflowDslService.create();
  return Object.fromEntries(sources.map((source) => [source.id, dsl.mappingFields(source.dsl)]));
}

describe.skipIf(!databaseUrl)("persisted workflow linkage", () => {
  beforeAll(async () => {
    await database().organization.create({
      data: { id: organizationId, name: organizationId, slug: organizationId },
    });
    await database().team.create({
      data: { id: teamId, name: teamId, slug: teamId, organizationId },
    });
    await database().project.create({
      data: {
        id: projectId,
        name: projectId,
        slug: projectId,
        teamId,
        language: "typescript",
        framework: "other",
        apiKey: `key_${suffix}`,
      },
    });
    await database().user.create({ data: { id: authorId, email: `${authorId}@example.com` } });
  });

  afterAll(async () => {
    try {
      const remaining = await database().workflow.findMany({
        where: { id: { in: workflowIds }, projectId },
      });
      for (const workflow of remaining) {
        await repository().deleteUncommitted({ projectId, workflowId: workflow.id });
      }
      await database().project.delete({ where: { id: projectId } });
      await database().user.delete({ where: { id: authorId } });
      await database().team.delete({ where: { id: teamId } });
      await database().organization.delete({ where: { id: organizationId } });
    } finally {
      await connection?.closeOnce();
    }
  });

  it("reads multiple entry/end fields in a batch and preserves object outputs", async () => {
    const outputs = [
      { identifier: "answer", type: "str" },
      { identifier: "chunks", type: "dict" },
    ];
    const first = await createWorkflow(outputs);
    const second = await createWorkflow([]);
    const result = await fields([first, second]);

    expect(result[first]).toEqual({
      inputFields: [{ identifier: "question", type: "str" }],
      outputFields: outputs,
      fieldsResolved: true,
    });
    expect(result[second]?.outputFields).toEqual([]);
    expect(result[second]?.fieldsResolved).toBe(true);
  });

  it("observes a newly committed graph without a copied field cache", async () => {
    const id = await createWorkflow([{ identifier: "answer", type: "str" }]);
    expect((await fields([id]))[id]?.outputFields).toHaveLength(1);
    await commitVersion(id, [
      { identifier: "answer", type: "str" },
      { identifier: "citations", type: "list" },
    ]);
    expect((await fields([id]))[id]?.outputFields.map((field) => field.identifier)).toEqual([
      "answer",
      "citations",
    ]);
  });

  it("excludes archived, missing and wrong-project workflows", async () => {
    const id = await createWorkflow([]);
    await repository().archiveLinked({ projectId, workflowId: id });
    expect(await fields([id, "missing"])).toEqual({});
    expect(
      await repository().listSummaries({ projectId: "another-project", workflowIds: [id] }),
    ).toEqual([]);
    await database().workflow.update({ where: { id, projectId }, data: { archivedAt: null } });
    expect(
      await repository().listSummaries({ projectId: "another-project", workflowIds: [id] }),
    ).toEqual([]);
    expect(
      await repository().listFieldSources({ projectId: "another-project", workflowIds: [id] }),
    ).toEqual([]);
  });

  it("deletes a copied workflow with version pointers and parent references", async () => {
    const id = await createWorkflow([]);
    const previous = await database().workflowVersion.findFirstOrThrow({
      where: { workflowId: id, projectId },
    });
    const next = await commitVersion(id, []);
    await database().workflowVersion.update({
      where: { id: next.id },
      data: { parentId: previous.id },
    });

    await repository().deleteUncommitted({ projectId, workflowId: id });

    expect(await database().workflowVersion.count({ where: { workflowId: id, projectId } })).toBe(
      0,
    );
    expect(await database().workflow.count({ where: { id, projectId } })).toBe(0);
  });
});
