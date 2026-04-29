import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { getTestUser } from "~/utils/testUtils";
import { prisma } from "~/server/db";
import { copyWorkflowWithDatasets } from "../workflows";
import type { Session } from "~/server/auth";

describe("copyWorkflowWithDatasets", () => {
  const sourceProjectId = "test-project-id";
  const targetProjectId = "test-project-id-copy-wf-target";
  const sourceWorkflowId = `test_wf_src_${nanoid(8)}`;
  let userId: string;
  const cleanupWorkflows: Array<{ id: string; projectId: string }> = [];

  beforeAll(async () => {
    const user = await getTestUser();
    userId = user.id;

    const teamUser = await prisma.teamUser.findFirst({
      where: { userId: user.id },
      include: { team: true },
    });
    if (!teamUser) throw new Error("Test user must have a team");

    const targetExists = await prisma.project.findUnique({
      where: { id: targetProjectId },
    });
    if (!targetExists) {
      await prisma.project.create({
        data: {
          id: targetProjectId,
          name: "Copy WF Target",
          slug: "copy-wf-target",
          apiKey: "test-api-key-copy-wf-target",
          teamId: teamUser.team.id,
          language: "en",
          framework: "test",
        },
      });
    }

    await prisma.workflow.create({
      data: {
        id: sourceWorkflowId,
        projectId: sourceProjectId,
        name: "Source Evaluator Workflow",
        icon: "🔍",
        description: "An evaluator workflow",
        isEvaluator: true,
        isComponent: false,
      },
    });
    cleanupWorkflows.push({ id: sourceWorkflowId, projectId: sourceProjectId });

    await prisma.workflowVersion.create({
      data: {
        id: `test_wfv_${nanoid(8)}`,
        workflowId: sourceWorkflowId,
        projectId: sourceProjectId,
        version: "1",
        dsl: { nodes: [], edges: [], state: {} },
        commitMessage: "initial",
        authorId: userId,
        autoSaved: false,
      },
    });

    const version = await prisma.workflowVersion.findFirst({
      where: { workflowId: sourceWorkflowId, projectId: sourceProjectId },
    });
    await prisma.workflow.update({
      where: { id: sourceWorkflowId },
      data: { latestVersionId: version?.id },
    });
  });

  afterAll(async () => {
    for (const { id, projectId } of cleanupWorkflows) {
      await prisma.workflow
        .update({
          where: { id, projectId },
          data: { latestVersionId: null, currentVersionId: null },
        })
        .catch(() => {});
      await prisma.workflowVersion
        .updateMany({ where: { workflowId: id, projectId }, data: { parentId: null } })
        .catch(() => {});
      await prisma.workflowVersion
        .deleteMany({ where: { workflowId: id, projectId } })
        .catch(() => {});
      await prisma.workflow.delete({ where: { id } }).catch(() => {});
    }
  });

  const getCtx = () => ({
    prisma,
    session: { user: { id: userId } } as Session,
  });

  describe("when source workflow is an evaluator", () => {
    it("preserves isEvaluator on the copied workflow", async () => {
      const source = await prisma.workflow.findUnique({
        where: { id: sourceWorkflowId },
        include: { latestVersion: true },
      });

      const { workflowId } = await copyWorkflowWithDatasets({
        ctx: getCtx(),
        workflow: {
          id: source!.id,
          name: source!.name,
          icon: source!.icon,
          description: source!.description,
          isEvaluator: source!.isEvaluator,
          isComponent: source!.isComponent,
          latestVersion: source!.latestVersion,
        },
        targetProjectId,
        sourceProjectId,
      });
      cleanupWorkflows.push({ id: workflowId, projectId: targetProjectId });

      const copied = await prisma.workflow.findUnique({
        where: { id: workflowId },
      });

      expect(copied).not.toBeNull();
      expect(copied!.isEvaluator).toBe(true);
      expect(copied!.isComponent).toBe(false);
      expect(copied!.projectId).toBe(targetProjectId);
    });
  });

  describe("when source workflow is a component", () => {
    it("preserves isComponent on the copied workflow", async () => {
      const componentWorkflowId = `test_wf_comp_${nanoid(8)}`;

      await prisma.workflow.create({
        data: {
          id: componentWorkflowId,
          projectId: sourceProjectId,
          name: "Component Workflow",
          icon: "🧩",
          description: "A component",
          isEvaluator: false,
          isComponent: true,
        },
      });
      cleanupWorkflows.push({ id: componentWorkflowId, projectId: sourceProjectId });

      await prisma.workflowVersion.create({
        data: {
          id: `test_wfv_comp_${nanoid(8)}`,
          workflowId: componentWorkflowId,
          projectId: sourceProjectId,
          version: "1",
          dsl: { nodes: [], edges: [], state: {} },
          commitMessage: "initial",
          authorId: userId,
          autoSaved: false,
        },
      });
      const latestVersion = await prisma.workflowVersion.findFirst({
        where: { workflowId: componentWorkflowId, projectId: sourceProjectId },
      });
      await prisma.workflow.update({
        where: { id: componentWorkflowId },
        data: { latestVersionId: latestVersion?.id },
      });

      const source = await prisma.workflow.findUnique({
        where: { id: componentWorkflowId },
        include: { latestVersion: true },
      });

      const { workflowId } = await copyWorkflowWithDatasets({
        ctx: getCtx(),
        workflow: {
          id: source!.id,
          name: source!.name,
          icon: source!.icon,
          description: source!.description,
          isEvaluator: source!.isEvaluator,
          isComponent: source!.isComponent,
          latestVersion: source!.latestVersion,
        },
        targetProjectId,
        sourceProjectId,
      });
      cleanupWorkflows.push({ id: workflowId, projectId: targetProjectId });

      const copied = await prisma.workflow.findUnique({
        where: { id: workflowId },
      });

      expect(copied).not.toBeNull();
      expect(copied!.isEvaluator).toBe(false);
      expect(copied!.isComponent).toBe(true);
    });
  });
});
