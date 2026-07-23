import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HandleGenerationError,
  NotFoundError,
} from "~/server/prompt-config/errors";
import { PromptService, type VersionedPrompt } from "../prompt.service";

const SOURCE_PROMPT: VersionedPrompt = {
  id: "prompt_1h5icu8XRkHHbaQlrOgwq",
  name: "Support Bot",
  handle: "support-bot",
  scope: "PROJECT",
  version: 3,
  versionId: "version-3",
  versionCreatedAt: new Date("2026-01-01"),
  model: "gpt-5-mini",
  temperature: 0.4,
  prompt: "You are a support bot.",
  projectId: "project-1",
  organizationId: "org-1",
  messages: [{ role: "user", content: "{{question}}" }],
  authorId: "user-1",
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [{ identifier: "answer", type: "str" }],
  updatedAt: new Date("2026-01-01"),
  createdAt: new Date("2026-01-01"),
  tags: [{ name: "latest", versionId: "version-3" }],
  parameters: {},
};

/**
 * Builds a service whose database-touching methods are stubbed, so the handle
 * generation that sits between them runs for real.
 *
 * @param takenHandles - handles an existing prompt already occupies
 */
function buildService({
  source = SOURCE_PROMPT,
  takenHandles = [],
}: {
  source?: VersionedPrompt | null;
  takenHandles?: string[];
} = {}) {
  const service = new PromptService({} as unknown as PrismaClient);
  const taken = new Set(takenHandles);

  vi.spyOn(service, "getPromptByIdOrHandle").mockResolvedValue(source);
  vi.spyOn(service, "checkHandleUniqueness").mockImplementation(
    async ({ handle }) => !taken.has(handle),
  );
  const createPrompt = vi
    .spyOn(service, "createPrompt")
    .mockImplementation(async ({ handle }) =>
      handle ? { ...SOURCE_PROMPT, id: "prompt_new", handle } : SOURCE_PROMPT,
    );
  const setCopiedFromPrompt = vi
    .spyOn(service.repository, "setCopiedFromPrompt")
    .mockResolvedValue(undefined);

  return { service, createPrompt, setCopiedFromPrompt };
}

/** Asserts the handle the service settled on, as handed to `createPrompt`. */
const createdWithHandle = (handle: string) =>
  expect.objectContaining({ handle });

describe("PromptService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("duplicatePrompt()", () => {
    describe("given no other prompt has claimed the numbered handle", () => {
      it("numbers the duplicate from one", async () => {
        const { service, createPrompt } = buildService();

        await service.duplicatePrompt({
          idOrHandle: "support-bot",
          projectId: "project-1",
        });

        expect(createPrompt).toHaveBeenCalledWith(
          createdWithHandle("support-bot-1"),
        );
      });

      it("records where the duplicate came from", async () => {
        const { service, createPrompt } = buildService();

        await service.duplicatePrompt({
          idOrHandle: "support-bot",
          projectId: "project-1",
        });

        expect(createPrompt.mock.calls[0]?.[0]).toMatchObject({
          commitMessage: 'Duplicated from "support-bot"',
          projectId: "project-1",
        });
      });

      it("carries the source configuration over to the duplicate", async () => {
        const { service, createPrompt } = buildService();

        await service.duplicatePrompt({
          idOrHandle: "support-bot",
          projectId: "project-1",
          authorId: "user-2",
        });

        expect(createPrompt.mock.calls[0]?.[0]).toMatchObject({
          scope: "PROJECT",
          model: "gpt-5-mini",
          temperature: 0.4,
          prompt: "You are a support bot.",
          inputs: [{ identifier: "question", type: "str" }],
          outputs: [{ identifier: "answer", type: "str" }],
          authorId: "user-2",
        });
      });
    });

    describe("given earlier duplicates already hold the low numbers", () => {
      it("skips past them to the first free number", async () => {
        const { service, createPrompt } = buildService({
          takenHandles: ["support-bot-1", "support-bot-2"],
        });

        await service.duplicatePrompt({
          idOrHandle: "support-bot",
          projectId: "project-1",
        });

        expect(createPrompt).toHaveBeenCalledWith(
          createdWithHandle("support-bot-3"),
        );
      });
    });

    describe("given the source prompt has no handle", () => {
      it("numbers from a slug the handle format accepts", async () => {
        const { service, createPrompt } = buildService({
          source: { ...SOURCE_PROMPT, handle: null, name: "My Support Bot" },
        });

        await service.duplicatePrompt({
          idOrHandle: SOURCE_PROMPT.id,
          projectId: "project-1",
        });

        expect(createPrompt).toHaveBeenCalledWith(
          createdWithHandle("my-support-bot-1"),
        );
      });
    });

    describe("given the source prompt does not exist", () => {
      it("reports it as not found", async () => {
        const { service, createPrompt } = buildService({ source: null });

        await expect(
          service.duplicatePrompt({
            idOrHandle: "ghost",
            projectId: "project-1",
          }),
        ).rejects.toThrow(NotFoundError);

        expect(createPrompt).not.toHaveBeenCalled();
      });
    });

    describe("given every candidate handle is taken", () => {
      it("gives up rather than looping forever", async () => {
        const { service, createPrompt } = buildService({
          takenHandles: Array.from(
            { length: 101 },
            (_, i) => `support-bot-${i + 1}`,
          ),
        });

        await expect(
          service.duplicatePrompt({
            idOrHandle: "support-bot",
            projectId: "project-1",
          }),
        ).rejects.toThrow(HandleGenerationError);

        expect(createPrompt).not.toHaveBeenCalled();
      });

      it("stops after a hundred attempts past the first", async () => {
        const { service } = buildService({ takenHandles: [] });
        vi.spyOn(service, "checkHandleUniqueness").mockResolvedValue(false);

        await expect(
          service.duplicatePrompt({
            idOrHandle: "support-bot",
            projectId: "project-1",
          }),
        ).rejects.toThrow(HandleGenerationError);

        expect(service.checkHandleUniqueness).toHaveBeenCalledTimes(101);
      });
    });
  });

  describe("copyPrompt()", () => {
    describe("given the target project has no prompt under that handle", () => {
      it("keeps the source handle unsuffixed", async () => {
        const { service, createPrompt } = buildService();

        await service.copyPrompt({
          idOrHandle: "support-bot",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        });

        expect(createPrompt).toHaveBeenCalledWith(
          createdWithHandle("support-bot"),
        );
      });

      it("creates the copy in the target project", async () => {
        const { service, createPrompt } = buildService();

        await service.copyPrompt({
          idOrHandle: "support-bot",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        });

        expect(createPrompt.mock.calls[0]?.[0]).toMatchObject({
          projectId: "project-2",
          commitMessage: 'Copied from "support-bot"',
        });
      });

      it("records the prompt it was copied from, scoped to the target project", async () => {
        const { service, setCopiedFromPrompt } = buildService();

        const copy = await service.copyPrompt({
          idOrHandle: "support-bot",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        });

        expect(setCopiedFromPrompt).toHaveBeenCalledWith({
          id: "prompt_new",
          projectId: "project-2",
          copiedFromPromptId: SOURCE_PROMPT.id,
        });
        expect(copy.copiedFromPromptId).toBe(SOURCE_PROMPT.id);
      });
    });

    describe("given the target project already holds that handle", () => {
      it("suffixes the copy rather than colliding", async () => {
        const { service, createPrompt } = buildService({
          takenHandles: ["support-bot"],
        });

        await service.copyPrompt({
          idOrHandle: "support-bot",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        });

        expect(createPrompt).toHaveBeenCalledWith(
          createdWithHandle("support-bot_copy1"),
        );
      });

      it("counts up until it finds a free suffix", async () => {
        const { service, createPrompt } = buildService({
          takenHandles: [
            "support-bot",
            "support-bot_copy1",
            "support-bot_copy2",
          ],
        });

        await service.copyPrompt({
          idOrHandle: "support-bot",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        });

        expect(createPrompt).toHaveBeenCalledWith(
          createdWithHandle("support-bot_copy3"),
        );
      });
    });

    describe("given the source prompt does not exist", () => {
      it("reports it as not found", async () => {
        const { service, createPrompt } = buildService({ source: null });

        await expect(
          service.copyPrompt({
            idOrHandle: "ghost",
            sourceProjectId: "project-1",
            targetProjectId: "project-2",
          }),
        ).rejects.toThrow(NotFoundError);

        expect(createPrompt).not.toHaveBeenCalled();
      });
    });

    describe("given every candidate handle is taken", () => {
      it("stops after a hundred suffixes", async () => {
        const { service } = buildService();
        vi.spyOn(service, "checkHandleUniqueness").mockResolvedValue(false);

        await expect(
          service.copyPrompt({
            idOrHandle: "support-bot",
            sourceProjectId: "project-1",
            targetProjectId: "project-2",
          }),
        ).rejects.toThrow(HandleGenerationError);

        expect(service.checkHandleUniqueness).toHaveBeenCalledTimes(101);
      });
    });
  });
});
