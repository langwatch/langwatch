import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LlmConfigRepository } from "../llm-config.repository";

describe("LlmConfigRepository", () => {
  let prisma: PrismaClient;
  let repository: LlmConfigRepository;

  beforeEach(() => {
    prisma = {
      llmPromptConfig: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaClient;
    repository = new LlmConfigRepository(prisma);
  });

  describe("setCopiedFromPrompt", () => {
    describe("given a copy that was just created in a project", () => {
      it("records the prompt it was copied from", async () => {
        await repository.setCopiedFromPrompt({
          id: "prompt_copy",
          projectId: "project-2",
          copiedFromPromptId: "prompt_source",
        });

        expect(prisma.llmPromptConfig.update).toHaveBeenCalledWith(
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

        expect(prisma.llmPromptConfig.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "prompt_copy", projectId: "project-2" },
          }),
        );
      });
    });
  });
});
