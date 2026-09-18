import { beforeEach, describe, expect, it, vi } from "vitest";

import { migrationLockKey, withMigrationLock } from "../migration-lock.ts";

const database = vi.hoisted(() => ({
  query: vi.fn<(sql: string, values: string[]) => Promise<{ rows: { locked: boolean }[] }>>(),
  release: vi.fn(),
  connect: vi.fn(),
  end: vi.fn<() => Promise<void>>(),
}));

vi.mock("@langwatch/prisma-client", () => ({
  PrismaDriverAdapterService: {
    create: () => ({ create: () => ({ pool: { connect: database.connect, end: database.end } }) }),
  },
}));

beforeEach(() => {
  database.query.mockReset().mockResolvedValue({ rows: [{ locked: true }] });
  database.release.mockReset();
  database.connect
    .mockReset()
    .mockResolvedValue({ query: database.query, release: database.release });
  database.end.mockReset().mockResolvedValue();
});

describe("given the deployment migration lock", () => {
  describe("when another runner holds it", () => {
    it("waits on the same session and unlocks after the sequence", async () => {
      database.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
      const run = vi.fn(async () => {
        expect(database.query).toHaveBeenLastCalledWith("SELECT pg_advisory_lock($1::bigint)", [
          migrationLockKey(),
        ]);
        expect(database.release).not.toHaveBeenCalled();
      });
      await withMigrationLock("postgresql://localhost/test", run);
      expect(run).toHaveBeenCalledOnce();
      expect(database.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock($1::bigint)", [
        migrationLockKey(),
      ]);
      expect(database.connect).toHaveBeenCalledOnce();
      expect(database.release).toHaveBeenCalledOnce();
      expect(database.end).toHaveBeenCalledOnce();
    });
  });

  describe("when a task fails", () => {
    it("unlocks and closes the session before propagating the failure", async () => {
      const failure = new Error("task failed");
      await expect(
        withMigrationLock("postgresql://localhost/test", async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(database.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock($1::bigint)", [
        migrationLockKey(),
      ]);
      expect(database.release).toHaveBeenCalledOnce();
      expect(database.end).toHaveBeenCalledOnce();
    });
  });

  describe("when the database connection fails", () => {
    it("closes the pool and runs no migration", async () => {
      const failure = new Error("connection failed");
      database.connect.mockRejectedValueOnce(failure);
      const run = vi.fn<() => Promise<void>>();
      await expect(withMigrationLock("postgresql://localhost/test", run)).rejects.toBe(failure);
      expect(run).not.toHaveBeenCalled();
      expect(database.end).toHaveBeenCalledOnce();
    });
  });

  describe("when no database is configured", () => {
    it("runs without opening a lock connection", async () => {
      const run = vi.fn<() => Promise<void>>().mockResolvedValue();
      await withMigrationLock(void 0, run);
      expect(run).toHaveBeenCalledOnce();
      expect(database.connect).not.toHaveBeenCalled();
    });
  });
});
