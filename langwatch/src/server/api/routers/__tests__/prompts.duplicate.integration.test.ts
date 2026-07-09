/**
 * @vitest-environment node
 *
 * Integration tests for `prompts.duplicate` — duplicating a prompt inside its
 * own project, through the real tRPC + Prisma layer.
 *
 * Binds specs/prompts/duplicate-prompt.feature.
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

// Fire-and-forget billing hook; it is not what these tests are about.
vi.mock("~/../ee/billing/nurturing/hooks/promptCreation", () => ({
  afterPromptCreated: vi.fn(),
}));

const projectId = "test-project-id";

describe("prompts.duplicate", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  const deleteTestPrompts = () =>
    prisma.llmPromptConfig.deleteMany({ where: { projectId } });

  /** Creates the "support-bot" prompt the feature file's Background assumes. */
  const givenASupportBotPrompt = () =>
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

  const promptHandles = async () => {
    const configs = await prisma.llmPromptConfig.findMany({
      where: { projectId, deletedAt: null },
      select: { handle: true },
    });
    // Handles are namespaced as `${projectId}/${handle}` in storage.
    return configs
      .map((c) => c.handle?.replace(`${projectId}/`, ""))
      .filter(Boolean)
      .sort();
  };

  beforeEach(async () => {
    vi.mocked(enforceLicenseLimit).mockReset();

    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    });
    caller = appRouter.createCaller(ctx);

    await deleteTestPrompts();
  });

  afterAll(async () => {
    await deleteTestPrompts();
  });

  describe("given a prompt exists in the project", () => {
    describe("when it is duplicated", () => {
      it("creates a new prompt numbered from one and leaves the original alone", async () => {
        const original = await givenASupportBotPrompt();

        const duplicate = await caller.prompts.duplicate({
          idOrHandle: original.id,
          projectId,
        });

        expect(duplicate.id).not.toBe(original.id);
        expect(duplicate.handle).toBe("support-bot-1");
        expect(await promptHandles()).toEqual(["support-bot", "support-bot-1"]);
      });

      it("keeps the duplicate in the project it was duplicated from", async () => {
        const original = await givenASupportBotPrompt();

        const duplicate = await caller.prompts.duplicate({
          idOrHandle: original.id,
          projectId,
        });

        expect(duplicate.projectId).toBe(projectId);
      });

      it("carries over the model, system prompt and input variables", async () => {
        const original = await givenASupportBotPrompt();

        const duplicate = await caller.prompts.duplicate({
          idOrHandle: original.id,
          projectId,
        });

        expect(duplicate.model).toBe("gpt-5-mini");
        expect(duplicate.temperature).toBe(0.4);
        expect(duplicate.prompt).toBe("You are a support bot.");
        expect(duplicate.inputs).toEqual([
          { identifier: "question", type: "str" },
        ]);
        expect(duplicate.outputs).toEqual([
          { identifier: "answer", type: "str" },
        ]);
      });

      it("starts the duplicate on its own version history", async () => {
        const original = await givenASupportBotPrompt();

        const duplicate = await caller.prompts.duplicate({
          idOrHandle: original.id,
          projectId,
        });

        expect(duplicate.versionId).not.toBe(original.versionId);

        const versions = await prisma.llmPromptConfigVersion.findMany({
          where: { configId: duplicate.id, projectId },
        });
        expect(versions).toHaveLength(1);
        expect(versions[0]?.commitMessage).toBe('Duplicated from "support-bot"');
      });

      it("checks the prompt allowance the plan grants before duplicating", async () => {
        const original = await givenASupportBotPrompt();
        // `prompts.create` enforces the same limit; forget its call so this
        // asserts on what `duplicate` does, not on what the setup did.
        vi.mocked(enforceLicenseLimit).mockClear();

        await caller.prompts.duplicate({
          idOrHandle: original.id,
          projectId,
        });

        expect(enforceLicenseLimit).toHaveBeenCalledTimes(1);
        expect(enforceLicenseLimit).toHaveBeenCalledWith(
          expect.anything(),
          projectId,
          "prompts",
        );
      });
    });

    describe("when it is duplicated twice", () => {
      it("numbers the second duplicate past the first", async () => {
        const original = await givenASupportBotPrompt();

        const first = await caller.prompts.duplicate({
          idOrHandle: original.id,
          projectId,
        });
        const second = await caller.prompts.duplicate({
          idOrHandle: original.id,
          projectId,
        });

        expect(first.handle).toBe("support-bot-1");
        expect(second.handle).toBe("support-bot-2");
        expect(await promptHandles()).toEqual([
          "support-bot",
          "support-bot-1",
          "support-bot-2",
        ]);
      });
    });
  });

  describe("given the organization has used up the prompt allowance its plan grants", () => {
    describe("when a duplicate is attempted", () => {
      it("reports the limit and creates no prompt", async () => {
        const original = await givenASupportBotPrompt();

        vi.mocked(enforceLicenseLimit).mockRejectedValueOnce(
          new TRPCError({
            code: "FORBIDDEN",
            message: "You have reached the maximum number of prompts",
          }),
        );

        await expect(
          caller.prompts.duplicate({ idOrHandle: original.id, projectId }),
        ).rejects.toThrow(/maximum number of prompts/i);

        expect(await promptHandles()).toEqual(["support-bot"]);
      });
    });
  });

  describe("given the prompt has been deleted", () => {
    describe("when a duplicate is attempted", () => {
      it("reports the prompt as not found", async () => {
        const original = await givenASupportBotPrompt();
        await caller.prompts.delete({ idOrHandle: original.id, projectId });

        await expect(
          caller.prompts.duplicate({ idOrHandle: original.id, projectId }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });
});
