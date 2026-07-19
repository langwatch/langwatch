/**
 * @vitest-environment node
 *
 * @see specs/workflows/workflow-node-owned-llm.feature
 *
 * Creating a workflow persists a model on every LLM node — through the
 * real tRPC mutation and the real database, with NO model default
 * configs seeded anywhere. A fresh environment must produce runnable
 * workflows out of the box; configured cascades and legacy payloads
 * must be honored.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// License limits need the app layer, which is not initialized under
// vitest — same workaround as the other router integration tests.
vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

import type { LLMConfig, Workflow } from "../../../../optimization_studio/types/dsl";
import { blankTemplate } from "../../../../optimization_studio/templates/blank";
import { DEFAULT_MODEL } from "../../../../utils/constants";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "workflow.create node LLM materialization",
  () => {
    const testNamespace = `wf-node-llm-${nanoid(8)}`;
    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let userId: string;
    let caller: ReturnType<typeof appRouter.createCaller>;

    const createdWorkflowIds: string[] = [];

    const persistedLlmValue = async (
      workflowId: string,
    ): Promise<LLMConfig | undefined> => {
      const workflow = await prisma.workflow.findUniqueOrThrow({
        where: { id: workflowId, projectId },
        include: { latestVersion: true },
      });
      const dsl = workflow.latestVersion?.dsl as unknown as Workflow;
      const signature = dsl.nodes.find((n) => n.type === "signature");
      return signature?.data.parameters?.find((p) => p.type === "llm")
        ?.value as LLMConfig | undefined;
    };

    const createFromBlankTemplate = async (dslOverrides?: object) => {
      const result = await caller.workflow.create({
        projectId,
        dsl: {
          ...JSON.parse(JSON.stringify(blankTemplate)),
          name: `Test ${nanoid(6)}`,
          version: "1",
          ...dslOverrides,
        },
        commitMessage: "Workflow creation",
      });
      createdWorkflowIds.push(result.workflow.id);
      return result;
    };

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: {
          name: "Test Organization",
          slug: `--test-org-${testNamespace}`,
        },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: {
          name: "Test Team",
          slug: `--test-team-${testNamespace}`,
          organizationId,
        },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: "Test Project",
          slug: `--test-project-${testNamespace}`,
          apiKey: `sk-lw-test-${nanoid()}`,
          teamId,
          language: "en",
          framework: "test",
        },
      });
      projectId = project.id;

      const user = await prisma.user.create({
        data: {
          name: "Test User",
          email: `test-${testNamespace}@example.com`,
        },
      });
      userId = user.id;

      await prisma.organizationUser.create({
        data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
      });
      await prisma.teamUser.create({
        data: { userId, teamId, role: TeamUserRole.ADMIN },
      });

      caller = appRouter.createCaller(
        createInnerTRPCContext({
          session: { user: { id: userId }, expires: "1" },
        }),
      );
    });

    afterAll(async () => {
      // Detach the required CurrentVersion/LatestVersion relations before
      // deleting versions, or the deleteMany violates the FK.
      await prisma.workflow.updateMany({
        where: { projectId },
        data: { currentVersionId: null, latestVersionId: null },
      });
      await prisma.workflowVersion.deleteMany({ where: { projectId } });
      await prisma.workflow.deleteMany({ where: { projectId } });
      await prisma.modelDefaultConfig.deleteMany({
        where: { organizationId },
      });
      await prisma.teamUser.deleteMany({ where: { teamId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.project.delete({ where: { id: projectId } });
      await prisma.team.delete({ where: { id: teamId } });
      await prisma.organization.delete({ where: { id: organizationId } });
      await prisma.user.delete({ where: { id: userId } });
    });

    /** @scenario Creating a workflow on a fresh install starts it with a ready-to-use model */
    it("persists the registry flagship on LLM nodes when nothing is configured anywhere", async () => {
      const { workflow } = await createFromBlankTemplate();

      const llm = await persistedLlmValue(workflow.id);
      expect(llm?.model).toBe(DEFAULT_MODEL);
      expect(llm?.model).not.toBe("");
    });

    /** @scenario Creating a workflow uses the configured default model when one is set */
    it("persists the cascade-resolved model when a project default is configured", async () => {
      const config = await prisma.modelDefaultConfig.create({
        data: {
          config: { DEFAULT: "anthropic/claude-haiku-4-5-20251001" },
          organizationId,
          scopes: {
            create: [{ scopeType: "PROJECT", scopeId: projectId }],
          },
        },
      });

      try {
        const { workflow } = await createFromBlankTemplate();
        const llm = await persistedLlmValue(workflow.id);
        expect(llm?.model).toBe("anthropic/claude-haiku-4-5-20251001");
      } finally {
        await prisma.modelDefaultConfig.delete({ where: { id: config.id } });
      }
    });

    /** @scenario A workflow created by an older client keeps its old workflow-wide model */
    it("folds a legacy client's default_llm into the node and drops the field", async () => {
      const { workflow } = await createFromBlankTemplate({
        default_llm: { model: "openai/gpt-5-mini", max_tokens: 256 },
      });

      const llm = await persistedLlmValue(workflow.id);
      expect(llm).toEqual({ model: "openai/gpt-5-mini", max_tokens: 256 });

      const stored = await prisma.workflow.findUniqueOrThrow({
        where: { id: workflow.id, projectId },
        include: { latestVersion: true },
      });
      expect(
        "default_llm" in (stored.latestVersion?.dsl as object),
      ).toBe(false);
    });

    /** @scenario An explicit node-owned model is never rewritten */
    it("keeps an explicit node-owned model untouched", async () => {
      const template = JSON.parse(
        JSON.stringify(blankTemplate),
      ) as typeof blankTemplate;
      const llmParam = template.nodes
        .find((n) => n.type === "signature")!
        .data.parameters!.find((p) => p.type === "llm")!;
      llmParam.value = { model: "gemini/gemini-2.5-flash" };

      const { workflow } = await createFromBlankTemplate({
        nodes: template.nodes,
      });

      const llm = await persistedLlmValue(workflow.id);
      expect(llm?.model).toBe("gemini/gemini-2.5-flash");
    });
  },
);
