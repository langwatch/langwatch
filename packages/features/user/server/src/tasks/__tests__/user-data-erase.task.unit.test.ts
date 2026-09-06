import { describe, expect, it, vi } from "vitest";
import { runGdprUserDataErase, UserDataEraseTask } from "../user-data-erase.task";
import type { GdprUserDataEraseRepository } from "../../repositories/prisma/prisma.user-data-erase.repository";

/**
 * A repository double with no organizations, teams or projects for the user.
 * Built untyped and cast once at the seam, the same pattern this repo's
 * repository unit tests use for a `PrismaClient` double (e.g.
 * `prisma.organization.repository.settings.unit.test.ts`).
 */
function emptyRepository(overrides: Record<string, unknown> = {}): GdprUserDataEraseRepository {
  const base: Record<string, unknown> = {
    // "email" lookup finds the user; "id" lookup (post-deletion
    // verification) finds nothing — the happy path already deleted them.
    findUserByEmail: vi.fn(async (email: string) => ({ id: "user_1", email, name: "Ada" })),
    findUserById: vi.fn(async () => null),
    findSoleOwnedOrganizations: vi.fn(async () => []),
    findSharedOrganizations: vi.fn(async () => []),
    findSoleOwnedTeams: vi.fn(async () => []),
    findSharedTeams: vi.fn(async () => []),
    findProjectsUnderTeams: vi.fn(async () => []),
    findSharedOrgsWhereUserIsSoleAdmin: vi.fn(async () => []),
    countOtherAdmins: vi.fn(async () => 0),
    findTeamsUnderSoleOrgsWithOtherMembers: vi.fn(async () => []),
    eraseUserAndOwnedResources: vi.fn(async () => undefined),
    ...overrides,
  };
  return base as unknown as GdprUserDataEraseRepository;
}

describe("runGdprUserDataErase", () => {
  describe("given no user with that email", () => {
    it("throws rather than running any deletion", async () => {
      const repository = emptyRepository({ findUserByEmail: vi.fn(async () => null) });
      await expect(
        runGdprUserDataErase({ repository, email: "missing@example.com", execute: true }),
      ).rejects.toThrow("No user found with email");
    });
  });

  describe("when the user is the sole ADMIN of a shared organization", () => {
    it("refuses without touching the erase transaction", async () => {
      const repository = emptyRepository({
        findSharedOrgsWhereUserIsSoleAdmin: vi.fn(async () => [
          { id: "org_1", name: "Shared Org" },
        ]),
        countOtherAdmins: vi.fn(async () => 0),
      });

      await expect(
        runGdprUserDataErase({ repository, email: "ada@example.com", execute: true }),
      ).rejects.toThrow("sole ADMIN");
      expect(repository.eraseUserAndOwnedResources).not.toHaveBeenCalled();
    });
  });

  describe("when execute is false", () => {
    it("reports the dry run without deleting the user", async () => {
      const repository = emptyRepository();
      const outcome = await runGdprUserDataErase({
        repository,
        email: "ada@example.com",
        execute: false,
      });

      expect(outcome.mode).toBe("dry-run");
      expect(outcome.blockers).toEqual([]);
      expect(repository.eraseUserAndOwnedResources).not.toHaveBeenCalled();
    });
  });

  describe("when execute is true and there are no blockers", () => {
    it("runs the erase transaction for the resolved user", async () => {
      const repository = emptyRepository();
      const outcome = await runGdprUserDataErase({
        repository,
        email: "ada@example.com",
        execute: true,
      });

      expect(outcome.mode).toBe("execute");
      expect(repository.eraseUserAndOwnedResources).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_1" }),
      );
    });
  });

  describe("when the user still exists after the transaction", () => {
    it("fails verification", async () => {
      const repository = emptyRepository({
        findUserById: vi.fn(async () => ({ id: "user_1", email: "ada@example.com", name: "Ada" })),
      });

      await expect(
        runGdprUserDataErase({ repository, email: "ada@example.com", execute: true }),
      ).rejects.toThrow("Deletion verification failed");
    });
  });
});

describe("UserDataEraseTask", () => {
  it("is named user-data-erase and reads the email and --execute from args", async () => {
    const repository = emptyRepository();
    const task = UserDataEraseTask.create({ repository: () => repository });
    expect(task.name).toBe("user-data-erase");

    const controller = new AbortController();
    await task.run({ args: ["ada@example.com", "--execute"], signal: controller.signal });

    expect(repository.eraseUserAndOwnedResources).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
    );
  });

  it("refuses to run without an email argument", async () => {
    const repository = emptyRepository();
    const task = UserDataEraseTask.create({ repository: () => repository });
    const controller = new AbortController();

    await expect(task.run({ args: ["--execute"], signal: controller.signal })).rejects.toThrow(
      "Email required",
    );
  });
});
