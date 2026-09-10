import type { Logger } from "@langwatch/observability";
import { describe, expect, it } from "vitest";
import { MigrationLock, UnlockedMigrationLock } from "../migration-lock.port.ts";
import { isMigrationTask, MigrationLockService } from "../migration-lock.service.ts";

/** Records what happened to the lock, and whether the first attempt was free. */
class FakeMigrationLock extends MigrationLock {
  readonly calls: string[] = [];

  constructor(private readonly free: boolean) {
    super();
  }

  tryAcquire(): Promise<boolean> {
    this.calls.push("tryAcquire");
    return Promise.resolve(this.free);
  }

  acquire(): Promise<void> {
    this.calls.push("acquire");
    return Promise.resolve();
  }

  release(): Promise<void> {
    this.calls.push("release");
    return Promise.resolve();
  }
}

function recordingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (first: unknown, second?: unknown): void => {
    lines.push(typeof first === "string" ? first : String(second ?? ""));
  };
  const logger = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    trace: record,
    fatal: record,
    child: () => logger,
  } as unknown as Logger;
  return { logger, lines };
}

describe("given the migration step runs under a lock", () => {
  describe("when the lock is free", () => {
    /** @scenario "Waiting is announced once, and only when there was a wait" */
    it("takes it without saying anything", async () => {
      const lock = new FakeMigrationLock(true);
      const { logger, lines } = recordingLogger();

      await MigrationLockService.create({ lock, logger }).run(() => Promise.resolve("done"));

      expect(lock.calls).toEqual(["tryAcquire", "release"]);
      expect(lines).toEqual([]);
    });
  });

  describe("when another runner holds the lock", () => {
    /** @scenario "A runner that has to wait says so" */
    it("says once that it is waiting, then blocks for it", async () => {
      const lock = new FakeMigrationLock(false);
      const { logger, lines } = recordingLogger();

      await MigrationLockService.create({ lock, logger }).run(() => Promise.resolve("done"));

      expect(lock.calls).toEqual(["tryAcquire", "acquire", "release"]);
      expect(lines).toEqual(["waiting for migration lock held by another runner"]);
    });

    /** @scenario "A second runner waits for the first rather than migrating alongside it" */
    it("runs the work only after the wait", async () => {
      const lock = new FakeMigrationLock(false);
      const { logger } = recordingLogger();
      const order: string[] = [];

      await MigrationLockService.create({ lock, logger }).run(() => {
        order.push(`work after ${lock.calls.join(",")}`);
        return Promise.resolve(0);
      });

      expect(order).toEqual(["work after tryAcquire,acquire"]);
    });
  });

  describe("when the work throws", () => {
    /** @scenario "The lock is released even when a task fails" */
    it("releases the lock before the failure is reported", async () => {
      const lock = new FakeMigrationLock(true);
      const { logger } = recordingLogger();

      await expect(
        MigrationLockService.create({ lock, logger }).run(() =>
          Promise.reject(new Error("migration failed")),
        ),
      ).rejects.toThrow("migration failed");
      expect(lock.calls).toEqual(["tryAcquire", "release"]);
    });
  });

  describe("when no database is configured", () => {
    /** @scenario "A stack with no database configured prepares without a lock" */
    it("runs the tasks without waiting for anything", async () => {
      const { logger, lines } = recordingLogger();

      const result = await MigrationLockService.create({
        lock: new UnlockedMigrationLock(),
        logger,
      }).run(() => Promise.resolve("ran"));

      expect(result).toBe("ran");
      expect(lines).toEqual([]);
    });
  });
});

describe("given a task name", () => {
  /** @scenario "A second runner waits for the first rather than migrating alongside it" */
  it("counts the three schema tasks as needing the lock and nothing else", () => {
    expect(["prisma-migrate", "clickhouse-migrate", "lwql-provision"].every(isMigrationTask)).toBe(
      true,
    );
    expect(isMigrationTask("process-manager-purge")).toBe(false);
  });
});
