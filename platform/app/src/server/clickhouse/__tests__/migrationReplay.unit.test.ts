/**
 * @vitest-environment node
 *
 * The lock that keeps two migration replays from corrupting each other.
 *
 * Vitest starts the next test file's fork before the previous file has
 * finished, so an `afterAll` that replays a migration overlaps the next
 * file's `beforeAll` that replays the same one. A rebuild migration drops and
 * recreates scratch tables under fixed names, so overlapping replays fail with
 * "table already exists" or "table does not exist" from a migration whose own
 * statements are perfectly ordered.
 */
import { stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withReplayLock } from "./migrationReplay";

/** A key of its own per test, so a run never waits on a neighbour's lock. */
let counter = 0;
const freshKey = () => `unit-replay-lock-${process.pid}-${counter++}`;

const lockPathFor = (key: string) =>
  join(tmpdir(), `langwatch-migration-replay-${key}.lock`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("given two callers reaching the same database at once", () => {
  describe("when both ask to replay", () => {
    it("runs them one after the other, never overlapping", async () => {
      const key = freshKey();
      let inside = 0;
      let maxInside = 0;
      const order: string[] = [];

      const body = (label: string) => async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        order.push(`${label}:enter`);
        await sleep(30);
        order.push(`${label}:exit`);
        inside -= 1;
      };

      await Promise.all([
        withReplayLock(key, body("a")),
        withReplayLock(key, body("b")),
      ]);

      expect(maxInside).toBe(1);
      // Whichever won, it finished before the other started.
      expect(order[1]).toBe(`${order[0]?.split(":")[0]}:exit`);
    });
  });
});

describe("given callers on different databases", () => {
  describe("when both ask to replay", () => {
    it("does not make one wait on the other", async () => {
      const [first, second] = [freshKey(), freshKey()];
      let inside = 0;
      let maxInside = 0;

      const body = async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        await sleep(30);
        inside -= 1;
      };

      await Promise.all([
        withReplayLock(first, body),
        withReplayLock(second, body),
      ]);

      expect(maxInside).toBe(2);
    });
  });
});

describe("given a lock left behind by a process that died holding it", () => {
  describe("when the next caller arrives", () => {
    // The stale threshold has to sit below the wait timeout or this branch is
    // unreachable and a leaked lock fails every later suite in the shard.
    it("breaks the lock instead of waiting for a holder that will never return", async () => {
      const key = freshKey();
      const lockPath = lockPathFor(key);
      await writeFile(lockPath, "999999");
      const longAgo = new Date(Date.now() - 45_000);
      await utimes(lockPath, longAgo, longAgo);

      const startedAt = Date.now();
      await expect(withReplayLock(key, async () => "ran")).resolves.toBe("ran");

      expect(Date.now() - startedAt).toBeLessThan(5_000);
    });
  });
});

describe("given a replay that throws", () => {
  describe("when the next caller arrives", () => {
    it("releases the lock rather than stranding it", async () => {
      const key = freshKey();

      await expect(
        withReplayLock(key, () => Promise.reject(new Error("replay blew up"))),
      ).rejects.toThrow("replay blew up");

      await expect(stat(lockPathFor(key))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(withReplayLock(key, async () => "ran")).resolves.toBe("ran");
    });
  });
});

describe("given a replay in progress", () => {
  describe("when the lock file is inspected from inside it", () => {
    // The file is what another process sees, so it has to exist for the whole
    // body and be named after the database it guards.
    it("holds a lock file named for that database", async () => {
      const key = freshKey();
      let heldDuringRun = false;

      await withReplayLock(key, async () => {
        heldDuringRun = await stat(lockPathFor(key))
          .then(() => true)
          .catch(() => false);
      });

      expect(heldDuringRun).toBe(true);
      await expect(stat(lockPathFor(key))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
