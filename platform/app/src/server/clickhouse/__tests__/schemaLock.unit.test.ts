/**
 * @vitest-environment node
 *
 * The lock's own lifecycle. Mutual exclusion across processes cannot be shown
 * from inside one process, so it lives in schemaLock.integration.test.ts;
 * everything here is about what a single process does with the lock file, and
 * about the recovery protocol's refusal to remove a lock it did not inspect.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSchemaLock } from "./schemaLock";

let lockPath: string;

/** A pid no process can have, so liveness checks read it as gone. */
const DEAD_PID = 2 ** 31 - 1;

function writeForeignLock({ pid, token }: { pid: number; token: string }) {
  writeFileSync(lockPath, `${token} ${pid} ${new Date().toISOString()}\n`);
}

beforeEach(() => {
  lockPath = join(mkdtempSync(join(tmpdir(), "schema-lock-")), "schema.lock");
});

afterEach(() => {
  // Each test gets its own directory, so nothing needs unlinking; this just
  // keeps a failed assertion from leaving a held lock behind for the next.
  if (existsSync(lockPath)) writeFileSync(lockPath, "");
});

describe("given nobody holds the schema lock", () => {
  describe("when a suite acquires it", () => {
    /** @scenario "Acquiring the lock records the holder and releasing frees it" */
    it("writes the holder's pid and frees the path on release", async () => {
      const lock = createSchemaLock({ lockPath });

      const release = await lock.acquire();

      expect(existsSync(lockPath)).toBe(true);
      expect(readFileSync(lockPath, "utf-8")).toContain(` ${process.pid} `);

      release();

      expect(existsSync(lockPath)).toBe(false);
    });

    /** @scenario "Acquiring the lock records the holder and releasing frees it" */
    it("ignores a second call to the same release", async () => {
      const lock = createSchemaLock({ lockPath });

      const release = await lock.acquire();
      release();
      release();

      expect(existsSync(lockPath)).toBe(false);
    });
  });
});

describe("given the lock is already held by this process", () => {
  describe("when the same process acquires it again", () => {
    /** @scenario "A suite holding the lock can still replay a migration" */
    it("grants it immediately and frees it only on the outermost release", async () => {
      const lock = createSchemaLock({ lockPath, waitTimeoutMs: 500 });

      const outer = await lock.acquire();
      const inner = await lock.acquire();

      expect(existsSync(lockPath)).toBe(true);

      inner();
      expect(existsSync(lockPath)).toBe(true);

      outer();
      expect(existsSync(lockPath)).toBe(false);
    });
  });
});

describe("given another live process holds the lock", () => {
  describe("when a suite waits longer than it is allowed to", () => {
    /** @scenario "A suite that cannot get the lock fails loudly" */
    it("fails naming the lock and its holder", async () => {
      // This process is alive by definition, so a foreign token under this
      // pid is a holder that will never be recovered.
      writeForeignLock({ pid: process.pid, token: randomUUID() });
      const lock = createSchemaLock({
        lockPath,
        waitTimeoutMs: 60,
        pollIntervalMs: 10,
      });

      await expect(lock.acquire()).rejects.toThrow(
        new RegExp(
          `waiting for the ClickHouse schema lock at .*${
            // The path is a regex literal in the message.
            "schema\\.lock"
          }`,
        ),
      );
      expect(existsSync(lockPath)).toBe(true);
    });
  });
});

describe("given the process that held the lock is gone", () => {
  describe("when another suite asks for it", () => {
    /** @scenario "A lock left by a killed run is recovered" */
    it("recovers the abandoned lock and takes it", async () => {
      writeForeignLock({ pid: DEAD_PID, token: randomUUID() });
      const lock = createSchemaLock({
        lockPath,
        waitTimeoutMs: 2_000,
        pollIntervalMs: 10,
      });

      const release = await lock.acquire();

      expect(readFileSync(lockPath, "utf-8")).toContain(` ${process.pid} `);
      release();
    });
  });

  describe("when another suite is already recovering that same holder", () => {
    /** @scenario "Recovery removes only the lock it inspected" */
    it("leaves the lock alone rather than racing the other recovery", async () => {
      const abandonedToken = randomUUID();
      writeForeignLock({ pid: DEAD_PID, token: abandonedToken });
      // The claim another waiter would be holding while it recovers this
      // exact owner. Only one waiter can create it, which is what stops two
      // recoveries from both unlinking the path.
      writeFileSync(`${lockPath}.recovery.${abandonedToken}`, "");
      const lock = createSchemaLock({
        lockPath,
        waitTimeoutMs: 60,
        pollIntervalMs: 10,
      });

      await expect(lock.acquire()).rejects.toThrow(
        /waiting for the ClickHouse schema lock/,
      );
      expect(readFileSync(lockPath, "utf-8")).toContain(` ${DEAD_PID} `);
    });
  });

  describe("when the lock changes hands before the recovery claims it", () => {
    /** @scenario "Recovery removes only the lock it inspected" */
    it("does not remove the new holder's lock", async () => {
      const abandonedToken = randomUUID();
      const liveToken = randomUUID();
      writeForeignLock({ pid: DEAD_PID, token: abandonedToken });

      const lock = createSchemaLock({
        lockPath,
        waitTimeoutMs: 120,
        pollIntervalMs: 10,
      });
      const acquiring = lock.acquire();

      // Stand in for the sequence the recovery has to survive: the abandoned
      // holder's lock is replaced by a live holder's between the poll that
      // read it and the claim that would remove it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      writeForeignLock({ pid: process.pid, token: liveToken });

      await expect(acquiring).rejects.toThrow(
        /waiting for the ClickHouse schema lock/,
      );
      expect(readFileSync(lockPath, "utf-8")).toContain(liveToken);
    });
  });
});

describe("given the lock was taken away from its holder", () => {
  describe("when that holder releases", () => {
    /** @scenario "A holder that lost the lock says so instead of freeing someone else's" */
    it("refuses to unlink a lock a different holder owns", async () => {
      const lock = createSchemaLock({ lockPath });
      const release = await lock.acquire();

      writeForeignLock({ pid: process.pid, token: randomUUID() });

      expect(() => release()).toThrow(/held by pid .* under a different token/);
      expect(existsSync(lockPath)).toBe(true);
    });
  });
});
