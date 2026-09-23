/**
 * @vitest-environment node
 * Restoring a version has two refusals persistence owns. Both were plain Errors reaching the
 * boundary as a 500; main answers 404 and 409 (measured 2026-09-21).
 * @see modules/prompt/specs/prompt-version-restore.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  PrismaLlmConfigVersionsRepository,
  type PromptVersionDatabase,
} from "../prisma.prompt-version.repository.ts";

function repository(findUnique: ReturnType<typeof vi.fn>) {
  const prisma = {
    llmPromptConfigVersion: { findUnique },
    llmPromptConfig: {},
    project: {},
    $transaction: vi.fn(),
  } as unknown as PromptVersionDatabase;

  return PrismaLlmConfigVersionsRepository.create({ prisma });
}

const RESTORE = {
  id: "prompt_version_1",
  projectId: "project-1",
  organizationId: "organization-1",
  authorId: null,
};

describe("restoring a prompt version", () => {
  describe("given no such version", () => {
    /** @scenario "Restoring a version that does not exist is refused by name" */
    it("refuses with a handled not-found rather than an unattributed failure", async () => {
      const repo = repository(vi.fn().mockResolvedValue(null));

      await expect(repo.restoreVersion(RESTORE)).rejects.toMatchObject({
        code: "prompt_not_found",
        httpStatus: 404,
      });
    });
  });

  describe("given a version number the prompt already has", () => {
    /** @scenario "A restore that collides on the version number answers a conflict" */
    it("names the conflict instead of letting the constraint error escape", async () => {
      const repo = repository(
        vi.fn().mockResolvedValue({
          id: RESTORE.id,
          projectId: RESTORE.projectId,
          configId: "config-1",
          version: 3,
          schemaVersion: "1.0",
          configData: {},
          runtimeParameters: null,
        }),
      );
      // The uniqueness the database actually enforces, in the shape Prisma
      // reports it.
      vi.spyOn(repo, "createVersion").mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
          meta: { target: ["configId", "version"] },
        }),
      );

      await expect(repo.restoreVersion(RESTORE)).rejects.toMatchObject({
        code: "prompt_version_conflict",
        httpStatus: 409,
      });
    });
  });
});
