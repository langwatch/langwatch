import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
  PrismaLlmConfigRepository,
  type PromptConfigDatabase,
} from "../prisma.prompt.repository.ts";

describe("PrismaLlmConfigRepository", () => {
  // Held apart from `prisma` so assertions inspect the mock's own call
  // history rather than extracting the generated Prisma client's `update`
  // as an unbound method.
  let update: Mock<(...args: unknown[]) => Promise<unknown>>;
  let prisma: PromptConfigDatabase;
  let repository: PrismaLlmConfigRepository;

  beforeEach(() => {
    update = vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    prisma = prismaDouble({
      llmPromptConfig: { update },
    });
    repository = PrismaLlmConfigRepository.create({ prisma });
  });

  describe("setCopiedFromPrompt()", () => {
    describe("given a copy that was just created in a project", () => {
      it("records the prompt it was copied from", async () => {
        await repository.setCopiedFromPrompt({
          id: "prompt_copy",
          projectId: "project-2",
          copiedFromPromptId: "prompt_source",
        });

        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { copiedFromPromptId: "prompt_source" },
          }),
        );
      });

      // Every write against a project-scoped model must carry projectId, so a
      // prompt id alone can never reach a row belonging to another tenant.
      it("scopes the write to that project", async () => {
        await repository.setCopiedFromPrompt({
          id: "prompt_copy",
          projectId: "project-2",
          copiedFromPromptId: "prompt_source",
        });

        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "prompt_copy", projectId: "project-2" },
          }),
        );
      });
    });
  });
});
