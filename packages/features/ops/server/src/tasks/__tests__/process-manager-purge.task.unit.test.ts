import { describe, expect, it, vi } from "vitest";
import {
  PrismaProcessManagerPurgeRepository,
  type ProcessManagerPurgeDatabase,
} from "../../repositories/prisma/prisma.process-manager-purge.repository";
import { purgeProcessManagerTables } from "../process-manager-purge.task";

/**
 * A database double that answers the two counts and hands back one full batch
 * then an empty one, so a purge that applies runs its loop to exhaustion.
 */
function fakeRepository({
  eligible = 12n,
  batches = [7, 0],
}: { eligible?: bigint; batches?: number[] } = {}) {
  const statements: string[] = [];
  const remaining = [...batches, ...batches];
  const database = {
    $queryRaw: vi.fn(async (query: { strings?: readonly string[] }) => {
      statements.push(query.strings?.join("?") ?? "");
      return [{ n: eligible }];
    }),
    $executeRaw: vi.fn(async (query: { strings?: readonly string[] }) => {
      statements.push(query.strings?.join("?") ?? "");
      return remaining.shift() ?? 0;
    }),
    $executeRawUnsafe: vi.fn(async (query: string) => {
      statements.push(query);
      return 0;
    }),
  };
  const repository = PrismaProcessManagerPurgeRepository.create({
    database: database as unknown as ProcessManagerPurgeDatabase,
  });
  return { repository, statements };
}

describe("purgeProcessManagerTables", () => {
  describe("given a backlog and no instruction to apply", () => {
    /** @scenario "The process-manager purge counts the backlog before deleting it" */
    it("reports what is eligible in each table and deletes nothing", async () => {
      const { repository, statements } = fakeRepository();

      const report = await purgeProcessManagerTables({ repository });

      expect(report.mode).toBe("dry-run");
      expect(report.targets.map((target) => target.eligible)).toEqual([12, 12]);
      expect(report.targets.every((target) => target.deleted === 0)).toBe(true);
      expect(statements.some((statement) => statement.includes("DELETE FROM"))).toBe(false);
    });
  });

  describe("when the operator applies the purge", () => {
    /** @scenario "The process-manager purge never touches work still owed" */
    it("deletes only dispatched outbox rows and consumed inbox rows", async () => {
      const { repository, statements } = fakeRepository();

      const report = await purgeProcessManagerTables({ repository, apply: true, sleepMs: 0 });

      expect(report.targets.map((target) => target.deleted)).toEqual([7, 7]);
      const deletes = statements.filter((statement) => statement.includes("DELETE FROM"));
      expect(deletes).toHaveLength(4);
      expect(deletes[0]).toContain(`"status" = 'dispatched'`);
      expect(deletes[2]).toContain(`"consumedAt" <`);
      expect(statements.some((statement) => statement.includes(`'pending'`))).toBe(false);
      expect(statements.some((statement) => statement.includes(`'dead'`))).toBe(false);
    });
  });

  describe("when the retention window is zero days", () => {
    /** @scenario "An unusable retention window deletes nothing" */
    it("refuses before issuing any statement and says what is usable", async () => {
      const { repository, statements } = fakeRepository();

      await expect(
        purgeProcessManagerTables({ repository, retentionDays: 0, apply: true }),
      ).rejects.toThrow("retentionDays must be a whole number of at least 1");
      expect(statements).toEqual([]);
    });
  });
});
