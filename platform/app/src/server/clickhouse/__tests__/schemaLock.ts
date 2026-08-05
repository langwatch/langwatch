/**
 * A cross-process mutex for the ClickHouse schema an integration run shares.
 *
 * Vitest starts the next test file's fork before the previous file's hooks
 * have finished, and the suite can be asked to run files concurrently
 * outright, so a suite that rebuilds a shared table overlaps a suite that
 * reads one. The rollup rebuild is not tenant-scoped: it drops
 * `gateway_budget_scope_totals_mv`, re-derives the table from the ledger,
 * swaps it in and recreates the view. A neighbour writing the ledger in that
 * window loses rows the missing view never folded, and a neighbour reading
 * the rollup sees it partway through being re-derived. Both surface as an
 * assertion about spend rather than as an error, and both repair themselves
 * moments later, which is what makes them reruns-pass flakes.
 *
 * The lock file is created with the exclusive flag, so the filesystem decides
 * the winner rather than anything in the process.
 *
 * RECOVERING AN ABANDONED LOCK IS THE HARD PART. Checking the file and then
 * unlinking the pathname is not safe at any check interval: the holder can
 * release and a new holder acquire in between, and the waiter then deletes
 * the new holder's lock. Ownership therefore has a token, and recovery claims
 * the right to remove one specific token:
 *
 *   1. Read the owner. Leave it alone unless its process is gone.
 *   2. `link` the lock to a path derived from the OBSERVED token. `link`
 *      fails when the destination exists, so exactly one waiter can hold the
 *      claim for a given token, and the claim names the owner rather than a
 *      moment in time.
 *   3. Read the token back through the new link. A different token means the
 *      lock changed hands before the link and we linked the wrong inode; drop
 *      the claim and retry. The lock itself was never touched, so a
 *      misdirected claim costs nothing.
 *   4. On a match, unlink the lock. Nothing else can be at that path: the
 *      owner is dead so it cannot release, a waiter recovering the same token
 *      is excluded by the claim, and a waiter recovering any other token
 *      aborts at step 3.
 *
 * A hard kill between steps 2 and 4 leaves the claim behind and wedges that
 * one lock, which surfaces as the acquire timeout naming both paths. That is
 * deliberate: a stuck run that says so beats two migrations rebuilding the
 * same table at once.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_LOCK_PATH = join(tmpdir(), "langwatch-clickhouse-schema.lock");

/**
 * Under serial files a wait is the tail of one neighbour's teardown. Under
 * opt-in file parallelism it is a whole neighbouring file, so leave room for
 * the slowest of them and still surface below the 120s hook timeout, where
 * the message says what was waited for.
 */
const DEFAULT_WAIT_TIMEOUT_MS = 110_000;

const DEFAULT_POLL_INTERVAL_MS = 25;

/**
 * A live holder keeps the lock however long it needs, so this only has to
 * cover an owner line that cannot be read at all, and a pid that a different
 * process has since been given. No suite runs anywhere near this long, and
 * every waiter has given up well before it, so it cannot fire against a
 * holder that is really working.
 */
const DEFAULT_ABANDONED_AFTER_MS = 900_000;

type LockOwner =
  | { readonly state: "absent" }
  | { readonly state: "unreadable" }
  | { readonly state: "held"; readonly token: string; readonly pid: number };

export interface SchemaLock {
  /** Where the lock lives, for error messages and tests. */
  readonly path: string;
  /**
   * Waits for the lock and returns its release. Re-entrant within one
   * process: a suite holding it for a whole file still replays migrations
   * inside its own tests, and only the outermost release frees it.
   */
  acquire: () => Promise<() => void>;
}

export function createSchemaLock({
  lockPath = DEFAULT_LOCK_PATH,
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  abandonedAfterMs = DEFAULT_ABANDONED_AFTER_MS,
  onBeforeClaim,
}: {
  lockPath?: string;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  abandonedAfterMs?: number;
  /**
   * Runs between reading an abandoned owner and claiming it. That gap is the
   * window the protocol has to survive, and it is not reachable from outside
   * the process, so the lock's own test opens it deliberately.
   */
  onBeforeClaim?: () => void;
} = {}): SchemaLock {
  let depth = 0;
  let heldToken: string | undefined;

  const claimPathFor = (token: string) => `${lockPath}.recovery.${token}`;

  function readOwner(path: string): LockOwner {
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { state: "absent" };
      }
      throw error;
    }
    const [token, pid] = raw.trim().split(" ");
    const holderPid = Number.parseInt(pid ?? "", 10);
    if (!token || !Number.isInteger(holderPid)) return { state: "unreadable" };
    return { state: "held", token, pid: holderPid };
  }

  /** Whether the lock has sat untouched long enough to be junk. */
  function olderThanAbandonThreshold(): boolean {
    try {
      return Date.now() - statSync(lockPath).mtimeMs > abandonedAfterMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  function recoverIfAbandoned(): void {
    const observed = readOwner(lockPath);
    if (observed.state === "absent") return;
    if (observed.state === "unreadable") {
      if (olderThanAbandonThreshold()) unlinkIfPresent(lockPath);
      return;
    }
    // A living owner keeps its lock however long it wants. The file's mtime
    // is the moment it was acquired and is never refreshed, so it measures
    // how long the holder has had the lock rather than how long it has been
    // idle; recovering on age would evict a suite in the middle of its
    // critical section, which is the thing this lock exists to prevent.
    if (isProcessAlive(observed.pid)) return;

    const claimPath = claimPathFor(observed.token);
    onBeforeClaim?.();
    try {
      linkSync(lockPath, claimPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EEXIST: another waiter already claims this owner. ENOENT: the lock
      // went away while we looked at it, which is the outcome we wanted.
      if (code === "EEXIST" || code === "ENOENT") return;
      throw error;
    }

    try {
      const claimed = readOwner(claimPath);
      // A different token means the lock changed hands before the link, so
      // the inode now at `lockPath` belongs to someone we never inspected.
      if (claimed.state === "held" && claimed.token === observed.token) {
        unlinkIfPresent(lockPath);
      }
    } finally {
      unlinkIfPresent(claimPath);
    }
  }

  async function acquire(): Promise<() => void> {
    if (depth > 0) {
      depth++;
      return releaseOnce();
    }

    const deadline = Date.now() + waitTimeoutMs;
    for (;;) {
      const token = randomUUID();
      if (tryClaimLock(token)) {
        heldToken = token;
        depth = 1;
        process.on("exit", releaseOnProcessExit);
        return releaseOnce();
      }

      recoverIfAbandoned();

      if (Date.now() > deadline) {
        const owner = readOwner(lockPath);
        throw new Error(
          `timed out after ${waitTimeoutMs}ms waiting for the ClickHouse schema lock at ${lockPath}` +
            (owner.state === "held"
              ? `, held by pid ${owner.pid}. If that process is gone, a recovery claim may have been left at ${claimPathFor(owner.token)}; removing both files unblocks the run.`
              : "."),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  function tryClaimLock(token: string): boolean {
    let handle: number;
    try {
      handle = openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      writeSync(
        handle,
        `${token} ${process.pid} ${new Date().toISOString()}\n`,
      );
    } catch (error) {
      unlinkIfPresent(lockPath);
      throw error;
    } finally {
      closeSync(handle);
    }
    return true;
  }

  function releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      depth--;
      if (depth > 0) return;

      const owner = readOwner(lockPath);
      depth = 0;
      const wasHeldToken = heldToken;
      heldToken = undefined;
      process.removeListener("exit", releaseOnProcessExit);
      // Releasing a lock that is no longer ours would hand a second holder's
      // critical section away. It cannot happen under the protocol above, so
      // if it ever does, say so rather than compound it.
      if (owner.state === "held" && owner.token !== wasHeldToken) {
        throw new Error(
          `the ClickHouse schema lock at ${lockPath} is held by pid ${owner.pid} under a different token; this process never released it and something removed it early`,
        );
      }
      unlinkIfPresent(lockPath);
    };
  }

  /**
   * Removes the lock only while it still carries our token, so a process
   * exiting after its lock was taken away cannot free the new holder's.
   */
  function unlinkOwnLock(): void {
    const owner = readOwner(lockPath);
    if (owner.state === "held" && owner.token !== heldToken) return;
    unlinkIfPresent(lockPath);
  }

  /**
   * A worker killed between acquiring and releasing would otherwise leave the
   * lock standing until a waiter notices its pid is gone. Registered only
   * while the lock is held, and removed on release, so a process that builds
   * many locks does not accumulate listeners.
   */
  function releaseOnProcessExit(): void {
    if (heldToken !== undefined) unlinkOwnLock();
  }

  return { path: lockPath, acquire };
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 asks whether the process exists without touching it.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The lock every integration suite in this repository shares. */
const sharedSchemaLock = createSchemaLock();

export function acquireClickHouseSchemaLock(): Promise<() => void> {
  return sharedSchemaLock.acquire();
}
