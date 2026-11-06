import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { userFactsIn } from "../../app/__tests__/user.fixture.ts";
import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import { memoryUserRepositoriesOver } from "../../repositories/memory/memory.user.repositories.ts";
import type { GdprUserDataEraseRepository } from "../../repositories/user-data-erase.repository.ts";
import { runGdprUserDataErase, UserDataEraseTask } from "../user-data-erase.task.ts";

/** A repository double with no organizations, teams or projects for the user. */
function emptyRepository(overrides: Partial<GdprUserDataEraseRepository> = {}) {
  const base = {
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
  };
  const double: GdprUserDataEraseRepository = { ...base, ...overrides };
  return { double, mocks: { ...base, ...overrides } };
}

/** The dataset peer for a user who owns no projects: nothing to erase. */
function noDatasetContent() {
  return { eraseStoredContent: vi.fn(async () => ({ datasets: 0 })) };
}

describe("runGdprUserDataErase", () => {
  describe("given no user with that email", () => {
    it("throws rather than running any deletion", async () => {
      const { double: repository } = emptyRepository({ findUserByEmail: vi.fn(async () => null) });
      await expect(
        runGdprUserDataErase({
          repository,
          datasetContent: noDatasetContent(),
          email: "missing@example.com",
          execute: true,
        }),
      ).rejects.toThrow("No user found with email");
    });
  });

  describe("when the user is the sole ADMIN of a shared organization", () => {
    it("refuses without touching the erase transaction", async () => {
      const { double: repository, mocks } = emptyRepository({
        findSharedOrgsWhereUserIsSoleAdmin: vi.fn(async () => [
          { id: "org_1", name: "Shared Org" },
        ]),
        countOtherAdmins: vi.fn(async () => 0),
      });

      await expect(
        runGdprUserDataErase({
          repository,
          datasetContent: noDatasetContent(),
          email: "ada@example.com",
          execute: true,
        }),
      ).rejects.toThrow("sole ADMIN");
      expect(mocks.eraseUserAndOwnedResources).not.toHaveBeenCalled();
    });
  });

  describe("when execute is false", () => {
    it("reports the dry run without deleting the user", async () => {
      const { double: repository, mocks } = emptyRepository();
      const outcome = await runGdprUserDataErase({
        repository,
        datasetContent: noDatasetContent(),
        email: "ada@example.com",
        execute: false,
      });

      expect(outcome.mode).toBe("dry-run");
      expect(outcome.blockers).toEqual([]);
      expect(mocks.eraseUserAndOwnedResources).not.toHaveBeenCalled();
    });
  });

  describe("when execute is true and there are no blockers", () => {
    /** @scenario "Erasing a user with no blockers runs the erase transaction for the resolved user" */
    it("runs the erase transaction for the resolved user", async () => {
      const { double: repository, mocks } = emptyRepository();
      const outcome = await runGdprUserDataErase({
        repository,
        datasetContent: noDatasetContent(),
        email: "ada@example.com",
        execute: true,
      });

      expect(outcome.mode).toBe("execute");
      expect(mocks.eraseUserAndOwnedResources).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_1" }),
      );
    });
  });

  describe("given a stored user in user's memory store", () => {
    async function storedUser() {
      const processStore = InMemoryProcessStore.createForTesting();
      const database = MemoryUserDatabase.create({ processStore });
      const repositories = memoryUserRepositoriesOver({ database });
      const { id } = await repositories.users.create({ name: "Ada", email: "ada@example.com" });
      return { processStore, repository: repositories.dataErase, id };
    }

    /** @scenario "An erasure records user's erased fact with the erase" */
    it("commits the erased fact with the erase", async () => {
      const { processStore, repository, id } = await storedUser();

      await runGdprUserDataErase({
        repository,
        datasetContent: noDatasetContent(),
        email: "ada@example.com",
        execute: true,
      });

      expect(
        (await userFactsIn({ processStore, userIds: [id] })).filter(
          ({ type }) => type === "recordErased",
        ),
      ).toEqual([
        {
          type: "recordErased",
          data: { tenantId: id, userId: id, occurredAt: expect.any(Number) },
        },
      ]);
    });

    /** @scenario "A dry-run erasure records no fact" */
    it("records no erased fact on a dry run", async () => {
      const { processStore, repository, id } = await storedUser();

      await runGdprUserDataErase({
        repository,
        datasetContent: noDatasetContent(),
        email: "ada@example.com",
        execute: false,
      });

      expect(
        (await userFactsIn({ processStore, userIds: [id] })).filter(
          ({ type }) => type === "recordErased",
        ),
      ).toEqual([]);
    });
  });

  describe("given a sole-owned organization whose projects hold datasets", () => {
    const owned = (overrides: Partial<GdprUserDataEraseRepository> = {}) =>
      emptyRepository({
        findSoleOwnedOrganizations: vi.fn(async () => [{ id: "org_1", name: "Solo Org" }]),
        findSoleOwnedTeams: vi.fn(async () => [{ id: "team_1", name: "Solo Team" }]),
        findProjectsUnderTeams: vi.fn(async () => [
          { id: "project_1", name: "One", slug: "one", teamId: "team_1" },
          { id: "project_2", name: "Two", slug: "two", teamId: "team_1" },
        ]),
        ...overrides,
      });

    /** @scenario "Erasing an organization removes its dataset chunks, version chunks and single files" */
    it("erases the projects' dataset objects before the rows that name them", async () => {
      const order: string[] = [];
      const { double: repository } = owned({
        eraseUserAndOwnedResources: vi.fn(async () => {
          order.push("rows");
        }),
      });
      const datasetContent = {
        eraseStoredContent: vi.fn(async () => {
          order.push("objects");
          return { datasets: 3 };
        }),
      };

      await runGdprUserDataErase({
        repository,
        datasetContent,
        email: "ada@example.com",
        execute: true,
      });

      expect(datasetContent.eraseStoredContent).toHaveBeenCalledWith({
        projectIds: ["project_1", "project_2"],
      });
      expect(order).toEqual(["objects", "rows"]);
    });

    it("keeps the rows when erasing the objects fails, so a re-run finds them again", async () => {
      const { double: repository, mocks } = owned();
      const datasetContent = {
        eraseStoredContent: vi.fn(async () => {
          throw new Error("object storage is unavailable");
        }),
      };

      await expect(
        runGdprUserDataErase({
          repository,
          datasetContent,
          email: "ada@example.com",
          execute: true,
        }),
      ).rejects.toThrow("object storage is unavailable");
      expect(mocks.eraseUserAndOwnedResources).not.toHaveBeenCalled();
    });

    it("erases no object on a dry run", async () => {
      const { double: repository } = owned();
      const datasetContent = noDatasetContent();

      await runGdprUserDataErase({
        repository,
        datasetContent,
        email: "ada@example.com",
        execute: false,
      });

      expect(datasetContent.eraseStoredContent).not.toHaveBeenCalled();
    });
  });

  describe("when the user still exists after the transaction", () => {
    it("fails verification", async () => {
      const { double: repository } = emptyRepository({
        findUserById: vi.fn(async () => ({
          id: "user_1",
          email: "ada@example.com",
          name: "Ada",
        })),
      });

      await expect(
        runGdprUserDataErase({
          repository,
          datasetContent: noDatasetContent(),
          email: "ada@example.com",
          execute: true,
        }),
      ).rejects.toThrow("Deletion verification failed");
    });
  });
});

describe("UserDataEraseTask", () => {
  it("is named user-data-erase and reads the email and --execute from args", async () => {
    const { double: repository, mocks } = emptyRepository();
    const task = UserDataEraseTask.create({
      repository: () => repository,
      datasetContent: noDatasetContent(),
    });
    expect(task.name).toBe("user-data-erase");

    const controller = new AbortController();
    await task.run({ args: ["ada@example.com", "--execute"], signal: controller.signal });

    expect(mocks.eraseUserAndOwnedResources).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
    );
  });

  it("refuses to run without an email argument", async () => {
    const { double: repository } = emptyRepository();
    const task = UserDataEraseTask.create({
      repository: () => repository,
      datasetContent: noDatasetContent(),
    });
    const controller = new AbortController();

    await expect(task.run({ args: ["--execute"], signal: controller.signal })).rejects.toThrow(
      "Email required",
    );
  });
});
