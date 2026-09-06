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
import { readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withReplayLock } from "./migrationReplay";

/**
 * The one interleaving no amount of ordering inside this process can produce:
 * somebody takes the lock path in the window between the rename that frees it
 * and the restore that puts a stranger's copy back. Set to a path and the very
 * next rename recreates a lock there, under a third owner, before the restore
 * runs.
 */
const { retakeAfterNextRename, THIRD_OWNER } = vi.hoisted(() => ({
  retakeAfterNextRename: { path: null as string | null },
  THIRD_OWNER: "third-owner",
}));

/**
 * The other way a restore can fail: the path is still free, but the filesystem
 * refuses the link outright. Set `error` and the next restore rejects with it
 * rather than linking; `from` records where the stranger's copy was left, so
 * the test can clean it up.
 */
const { deniedRestore } = vi.hoisted(() => ({
  deniedRestore: {
    error: null as NodeJS.ErrnoException | null,
    from: null as string | null,
  },
}));

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      await actual.rename(from, to);
      const retaken = retakeAfterNextRename.path;
      if (retaken !== null) {
        retakeAfterNextRename.path = null;
        await actual.writeFile(retaken, THIRD_OWNER);
      }
    },
    link: async (from: string, to: string) => {
      const denial = deniedRestore.error;
      if (denial !== null) {
        deniedRestore.error = null;
        deniedRestore.from = from;
        throw denial;
      }
      await actual.link(from, to);
    },
  };
});

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
        withReplayLock({ database: key, run: body("a") }),
        withReplayLock({ database: key, run: body("b") }),
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
        withReplayLock({ database: first, run: body }),
        withReplayLock({ database: second, run: body }),
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
      await expect(
        withReplayLock({ database: key, run: async () => "ran" }),
      ).resolves.toBe("ran");

      expect(Date.now() - startedAt).toBeLessThan(5_000);
    });
  });
});

describe("given a stale lock several callers arrive at together", () => {
  describe("when they all try to break it", () => {
    // Breaking a corpse and taking its place are two steps, so the lock a
    // waiter measured can be a live replacement's by the time it removes it.
    // Removing that one puts two replays inside the critical section, which is
    // exactly what the lock exists to prevent.
    it("still lets only one of them run at a time", async () => {
      const key = freshKey();
      const lockPath = lockPathFor(key);
      await writeFile(lockPath, "999999");
      const longAgo = new Date(Date.now() - 45_000);
      await utimes(lockPath, longAgo, longAgo);

      let inside = 0;
      let maxInside = 0;
      const body = async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        await sleep(30);
        inside -= 1;
      };

      await Promise.all(
        Array.from({ length: 4 }, () =>
          withReplayLock({ database: key, run: body }),
        ),
      );

      expect(maxInside).toBe(1);
    });
  });
});

describe("given a holder whose lock was broken and taken by somebody else", () => {
  describe("when it finishes and releases", () => {
    it("leaves the replacement's lock where it is", async () => {
      const key = freshKey();
      const lockPath = lockPathFor(key);

      await withReplayLock({
        database: key,
        run: async () => {
          // What a stale break followed by a fresh acquisition looks like from
          // this holder's side: the file at the path is no longer its own.
          await rm(lockPath, { force: true });
          await writeFile(lockPath, "replacement-owner");
        },
      });

      await expect(readFile(lockPath, "utf-8")).resolves.toBe(
        "replacement-owner",
      );
      await rm(lockPath, { force: true });
    });
  });

  describe("when the path is taken again before the restore lands", () => {
    it("leaves the newest holder's lock alone rather than evicting it", async () => {
      const key = freshKey();
      const lockPath = lockPathFor(key);

      await withReplayLock({
        database: key,
        run: async () => {
          await rm(lockPath, { force: true });
          await writeFile(lockPath, "replacement-owner");
          retakeAfterNextRename.path = lockPath;
        },
      });

      // The restore refuses the path it no longer owns, so the holder that
      // took it keeps it and the stranger's copy is dropped instead. A restore
      // that overwrote would leave two holders each believing the lock is
      // theirs.
      await expect(readFile(lockPath, "utf-8")).resolves.toBe(THIRD_OWNER);
      await rm(lockPath, { force: true });
    });
  });

  describe("when the restore fails for a reason other than the path being taken", () => {
    // EEXIST is the restore doing its job, and the only failure it may absorb.
    // Every other code means the stranger's lock was moved away and never put
    // back, so answering "restored" to it loses a live holder's lock without
    // anything, anywhere, saying so.
    it("surfaces the failure rather than reporting a restore that did not happen", async () => {
      const key = freshKey();
      const lockPath = lockPathFor(key);
      deniedRestore.from = null;

      await expect(
        withReplayLock({
          database: key,
          run: async () => {
            await rm(lockPath, { force: true });
            await writeFile(lockPath, "replacement-owner");
            deniedRestore.error = Object.assign(
              new Error("EACCES: permission denied, link"),
              { code: "EACCES" },
            );
          },
        }),
      ).rejects.toMatchObject({ code: "EACCES" });

      deniedRestore.error = null;
      await rm(lockPath, { force: true });
      if (deniedRestore.from !== null) {
        await rm(deniedRestore.from, { force: true });
      }
    });
  });
});

describe("given a replay that throws", () => {
  describe("when the next caller arrives", () => {
    it("releases the lock rather than stranding it", async () => {
      const key = freshKey();

      await expect(
        withReplayLock({
          database: key,
          run: () => Promise.reject(new Error("replay blew up")),
        }),
      ).rejects.toThrow("replay blew up");

      await expect(stat(lockPathFor(key))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        withReplayLock({ database: key, run: async () => "ran" }),
      ).resolves.toBe("ran");
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

      await withReplayLock({
        database: key,
        run: async () => {
          heldDuringRun = await stat(lockPathFor(key))
            .then(() => true)
            .catch(() => false);
        },
      });

      expect(heldDuringRun).toBe(true);
      await expect(stat(lockPathFor(key))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
