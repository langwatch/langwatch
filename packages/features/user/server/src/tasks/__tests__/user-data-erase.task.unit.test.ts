import { describe, expect, it, vi } from "vitest";
import {
  runGdprUserDataErase,
  UserDataEraseTask,
  type GdprUserDataEraseDatabase,
} from "../user-data-erase.task";

const emptyMany = () => vi.fn(async () => ({ count: 0 }));

/**
 * A database double with no organizations, teams or projects for the user.
 * `GdprUserDataEraseDatabase` picks real (branded `PrismaPromise`-returning)
 * delegate methods, so a plain `vi.fn()` double is built untyped and cast
 * once at the seam — the same pattern this repo's repository unit tests use
 * for a `PrismaClient` double (e.g.
 * `prisma.organization.repository.settings.unit.test.ts`).
 */
function emptyDatabase(overrides: Record<string, unknown> = {}): GdprUserDataEraseDatabase {
  const base: Record<string, unknown> = {
    user: {
      // "email" lookup finds the user; "id" lookup (post-deletion
      // verification) finds nothing — the happy path already deleted them.
      findUnique: vi.fn(async ({ where }: { where: { email: string } | { id: string } }) =>
        "email" in where ? { id: "user_1", email: where.email, name: "Ada" } : null,
      ),
      delete: vi.fn(async () => undefined),
    },
    organization: { findMany: vi.fn(async () => []), deleteMany: emptyMany() },
    organizationUser: { count: vi.fn(async () => 0), deleteMany: emptyMany() },
    team: { findMany: vi.fn(async () => []), deleteMany: emptyMany() },
    teamUser: { deleteMany: emptyMany() },
    project: { findMany: vi.fn(async () => []), deleteMany: emptyMany() },
    account: { count: vi.fn(async () => 0), deleteMany: emptyMany() },
    session: { count: vi.fn(async () => 0), deleteMany: emptyMany() },
    annotation: { count: vi.fn(async () => 0), updateMany: emptyMany(), deleteMany: emptyMany() },
    shareLink: { count: vi.fn(async () => 0), updateMany: emptyMany(), deleteMany: emptyMany() },
    workflow: { count: vi.fn(async () => 0), updateMany: emptyMany(), deleteMany: emptyMany() },
    workflowVersion: { count: vi.fn(async () => 0), deleteMany: emptyMany() },
    llmPromptConfig: { findMany: vi.fn(async () => []), deleteMany: emptyMany() },
    llmPromptConfigVersion: {
      count: vi.fn(async () => 0),
      updateMany: emptyMany(),
      deleteMany: emptyMany(),
    },
    annotationQueueItem: {
      count: vi.fn(async () => 0),
      updateMany: emptyMany(),
      deleteMany: emptyMany(),
    },
    annotationQueueMembers: { count: vi.fn(async () => 0), deleteMany: emptyMany() },
    annotationQueueScores: { deleteMany: emptyMany() },
    annotationQueue: { findMany: vi.fn(async () => []), deleteMany: emptyMany() },
    auditLog: { count: vi.fn(async () => 0), updateMany: emptyMany() },
    batchEvaluation: { deleteMany: emptyMany() },
    monitor: { deleteMany: emptyMany() },
    experiment: { deleteMany: emptyMany() },
    datasetRecord: { deleteMany: emptyMany() },
    dataset: { deleteMany: emptyMany() },
    customGraph: { deleteMany: emptyMany() },
    dashboard: { deleteMany: emptyMany() },
    trigger: { deleteMany: emptyMany() },
    topic: { deleteMany: emptyMany() },
    cost: { deleteMany: emptyMany() },
    modelProviderScope: { deleteMany: emptyMany() },
    ...overrides,
  };
  base.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(base));
  return base as unknown as GdprUserDataEraseDatabase;
}

describe("runGdprUserDataErase", () => {
  describe("given no user with that email", () => {
    it("throws rather than running any deletion", async () => {
      const database = emptyDatabase({
        user: { findUnique: vi.fn(async () => null), delete: vi.fn() },
      });
      await expect(
        runGdprUserDataErase({ database, email: "missing@example.com", execute: true }),
      ).rejects.toThrow("No user found with email");
    });
  });

  describe("when the user is the sole ADMIN of a shared organization", () => {
    it("refuses without touching the transaction", async () => {
      // Two calls share the same {id, name} select: getSoleOwnedOrganizations
      // (first, inside the Promise.all — finds none) and the blocker check's
      // own admin query (after it — finds the shared org). Call order is
      // deterministic because Promise.all invokes its array in order.
      let plainSelectCalls = 0;
      const database = emptyDatabase({
        organization: {
          findMany: vi.fn(async ({ select }: { select: { _count?: unknown } }) => {
            if (select._count) return [];
            plainSelectCalls += 1;
            return plainSelectCalls === 1 ? [] : [{ id: "org_1", name: "Shared Org" }];
          }),
          deleteMany: emptyMany(),
        },
        organizationUser: { count: vi.fn(async () => 0), deleteMany: emptyMany() },
      });

      await expect(
        runGdprUserDataErase({ database, email: "ada@example.com", execute: true }),
      ).rejects.toThrow("sole ADMIN");
      expect(database.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("when execute is false", () => {
    it("reports the dry run without deleting the user", async () => {
      const database = emptyDatabase();
      const outcome = await runGdprUserDataErase({
        database,
        email: "ada@example.com",
        execute: false,
      });

      expect(outcome.mode).toBe("dry-run");
      expect(outcome.blockers).toEqual([]);
      expect(database.$transaction).not.toHaveBeenCalled();
      expect(database.user.delete).not.toHaveBeenCalled();
    });
  });

  describe("when execute is true and there are no blockers", () => {
    it("runs the deletion transaction and deletes the user", async () => {
      const database = emptyDatabase();
      const outcome = await runGdprUserDataErase({
        database,
        email: "ada@example.com",
        execute: true,
      });

      expect(outcome.mode).toBe("execute");
      expect(database.$transaction).toHaveBeenCalledOnce();
      expect(database.user.delete).toHaveBeenCalledWith({ where: { id: "user_1" } });
    });
  });

  describe("when the user still exists after the transaction", () => {
    it("fails verification", async () => {
      const database = emptyDatabase({
        user: {
          findUnique: vi.fn(async () => ({ id: "user_1", email: "ada@example.com", name: "Ada" })),
          delete: vi.fn(async () => undefined),
        },
      });

      await expect(
        runGdprUserDataErase({ database, email: "ada@example.com", execute: true }),
      ).rejects.toThrow("Deletion verification failed");
    });
  });
});

describe("UserDataEraseTask", () => {
  it("is named user-data-erase and reads the email and --execute from args", async () => {
    const database = emptyDatabase();
    const task = UserDataEraseTask.create({ database: () => database });
    expect(task.name).toBe("user-data-erase");

    const controller = new AbortController();
    await task.run({ args: ["ada@example.com", "--execute"], signal: controller.signal });

    expect(database.user.delete).toHaveBeenCalledWith({ where: { id: "user_1" } });
  });

  it("refuses to run without an email argument", async () => {
    const database = emptyDatabase();
    const task = UserDataEraseTask.create({ database: () => database });
    const controller = new AbortController();

    await expect(task.run({ args: ["--execute"], signal: controller.signal })).rejects.toThrow(
      "Email required",
    );
  });
});
