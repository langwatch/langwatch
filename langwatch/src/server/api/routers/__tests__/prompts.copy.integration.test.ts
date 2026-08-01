/**
 * @vitest-environment node
 *
 * Integration tests for `prompts.copy` — replicating a prompt into another
 * project, through the real tRPC + Prisma layer.
 *
 * `copy` had no integration coverage before the duplicate/copy service
 * extraction, so these pin the behavior the refactor must preserve.
 */
import { TRPCError } from "@trpc/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { enforceLicenseLimit } from "../../../license-enforcement";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("../../../license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../license-enforcement")>();
  return {
    ...actual,
    enforceLicenseLimit: vi.fn(),
  };
});

vi.mock("~/../ee/billing/nurturing/hooks/promptCreation", () => ({
  afterPromptCreated: vi.fn(),
}));

const sourceProjectId = "test-project-id";
const targetProjectId = "test-project-id-prompt-copy-target";

describe("prompts.copy", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  // Copies (target) before originals (source): a copied prompt references its
  // source through the PromptCopies self-relation.
  const deleteTestPrompts = async () => {
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: targetProjectId },
    });
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: sourceProjectId },
    });
  };

  const givenASupportBotPrompt = (projectId = sourceProjectId) =>
    caller.prompts.create({
      projectId,
      data: {
        handle: "support-bot",
        scope: "PROJECT",
        prompt: "You are a support bot.",
        model: "gpt-5-mini",
        temperature: 0.4,
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      },
    });

  const handlesIn = async (projectId: string) => {
    const configs = await prisma.llmPromptConfig.findMany({
      where: { projectId, deletedAt: null },
      select: { handle: true },
    });
    return configs
      .map((c) => c.handle?.replace(`${projectId}/`, ""))
      .filter(Boolean)
      .sort();
  };

  beforeEach(async () => {
    vi.mocked(enforceLicenseLimit).mockReset();

    const user = await getTestUser();
    const teamUser = await prisma.teamUser.findFirst({
      where: { userId: user.id },
      include: { team: true },
    });
    if (!teamUser) {
      throw new Error("Test user must have a team");
    }

    // Target project shares the team so the caller holds prompts:create in both.
    const exists = await prisma.project.findUnique({
      where: { id: targetProjectId },
    });
    if (!exists) {
      await prisma.project.create({
        data: {
          id: targetProjectId,
          name: "Prompt Copy Target",
          slug: "test-project-prompt-copy-target",
          apiKey: "test-api-key-prompt-copy-target",
          teamId: teamUser.team.id,
          language: "en",
          framework: "test-framework",
        },
      });
    }

    const ctx = createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    });
    caller = appRouter.createCaller(ctx);

    await deleteTestPrompts();
  });

  afterAll(async () => {
    await deleteTestPrompts();
  });

  describe("given the target project holds no prompt under that handle", () => {
    describe("when the prompt is replicated", () => {
      it("keeps the source handle and lands in the target project", async () => {
        const source = await givenASupportBotPrompt();

        const copy = await caller.prompts.copy({
          idOrHandle: source.id,
          projectId: targetProjectId,
          sourceProjectId,
        });

        expect(copy.id).not.toBe(source.id);
        expect(copy.handle).toBe("support-bot");
        expect(copy.projectId).toBe(targetProjectId);
      });

      it("records the prompt it was copied from", async () => {
        const source = await givenASupportBotPrompt();

        const copy = await caller.prompts.copy({
          idOrHandle: source.id,
          projectId: targetProjectId,
          sourceProjectId,
        });

        expect(copy.copiedFromPromptId).toBe(source.id);

        const stored = await prisma.llmPromptConfig.findFirst({
          where: { id: copy.id, projectId: targetProjectId },
          select: { copiedFromPromptId: true },
        });
        expect(stored?.copiedFromPromptId).toBe(source.id);
      });

      it("carries the source configuration over", async () => {
        const source = await givenASupportBotPrompt();

        const copy = await caller.prompts.copy({
          idOrHandle: source.id,
          projectId: targetProjectId,
          sourceProjectId,
        });

        expect(copy.model).toBe("gpt-5-mini");
        expect(copy.temperature).toBe(0.4);
        expect(copy.prompt).toBe("You are a support bot.");
        expect(copy.inputs).toEqual([{ identifier: "question", type: "str" }]);
      });

      it("leaves the source prompt untouched", async () => {
        const source = await givenASupportBotPrompt();

        await caller.prompts.copy({
          idOrHandle: source.id,
          projectId: targetProjectId,
          sourceProjectId,
        });

        expect(await handlesIn(sourceProjectId)).toEqual(["support-bot"]);
      });

      it("checks the prompt allowance the plan grants before copying", async () => {
        const source = await givenASupportBotPrompt();
        // `prompts.create` enforces the same limit; forget its call so this
        // asserts on what `copy` does, not on what the setup did.
        vi.mocked(enforceLicenseLimit).mockClear();

        await caller.prompts.copy({
          idOrHandle: source.id,
          projectId: targetProjectId,
          sourceProjectId,
        });

        expect(enforceLicenseLimit).toHaveBeenCalledTimes(1);
        expect(enforceLicenseLimit).toHaveBeenCalledWith(
          expect.anything(),
          targetProjectId,
          "prompts",
        );
      });
    });
  });

  describe("given the target project already holds that handle", () => {
    describe("when the prompt is replicated again", () => {
      it("suffixes the second copy rather than colliding", async () => {
        const source = await givenASupportBotPrompt();

        const first = await caller.prompts.copy({
          idOrHandle: source.id,
          projectId: targetProjectId,
          sourceProjectId,
        });
        const second = await caller.prompts.copy({
          idOrHandle: source.id,
          projectId: targetProjectId,
          sourceProjectId,
        });

        expect(first.handle).toBe("support-bot");
        expect(second.handle).toBe("support-bot_copy1");
        expect(await handlesIn(targetProjectId)).toEqual([
          "support-bot",
          "support-bot_copy1",
        ]);
      });
    });
  });

  describe("given the organization has used up the prompt allowance its plan grants", () => {
    describe("when a copy is attempted", () => {
      it("reports the limit and creates no prompt", async () => {
        const source = await givenASupportBotPrompt();

        vi.mocked(enforceLicenseLimit).mockRejectedValueOnce(
          new TRPCError({
            code: "FORBIDDEN",
            message: "You have reached the maximum number of prompts",
          }),
        );

        await expect(
          caller.prompts.copy({
            idOrHandle: source.id,
            projectId: targetProjectId,
            sourceProjectId,
          }),
        ).rejects.toThrow(/maximum number of prompts/i);

        expect(await handlesIn(targetProjectId)).toEqual([]);
      });
    });
  });

  describe("given the source prompt has been deleted", () => {
    describe("when a copy is attempted", () => {
      it("reports the prompt as not found", async () => {
        const source = await givenASupportBotPrompt();
        await caller.prompts.delete({
          idOrHandle: source.id,
          projectId: sourceProjectId,
        });

        await expect(
          caller.prompts.copy({
            idOrHandle: source.id,
            projectId: targetProjectId,
            sourceProjectId,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });
});
