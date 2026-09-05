/**
 * A cross-process mutex for the ClickHouse schema a run shares. Migration work
 * is not tenant-scoped, so a neighbour reads a half-derived table and a
 * neighbour writing loses rows — both as a wrong number, not an error.
 */

// The lock file is created with the exclusive flag, so the filesystem decides
// the winner rather than anything in the process. Recovering an abandoned lock
// is the hard part; see removeLockOwnedBy for the claim protocol.

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

/** Where the lock lands when the constructing task names no other path. */
export const DEFAULT_CLICKHOUSE_SCHEMA_LOCK_PATH = join(
  tmpdir(),
  "langwatch-clickhouse-schema.lock",
);

/**
 * Under file parallelism a wait is a whole neighbouring file, so leave room for
 * the slowest and still surface below the 120s hook timeout.
 */
const DEFAULT_WAIT_TIMEOUT_MS = 110_000;

const DEFAULT_POLL_INTERVAL_MS = 25;

/**
 * A live holder keeps the lock as long as it needs, so this only covers an
 * unreadable owner line and a recycled pid. No suite runs near this long, so it
 * cannot fire against a holder that is really working.
 */
const DEFAULT_ABANDONED_AFTER_MS = 900_000;

type LockOwner =
  | { readonly state: "absent" }
  | { readonly state: "unreadable" }
  | { readonly state: "held"; readonly token: string; readonly pid: number };

export type ClickHouseSchemaLockOptions = {
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
};

/**
 * One schema lock, owned by whoever constructed it. No process-wide instance:
 * which file is contended for is a decision at the composition point, not a
 * constant a shared package reached for on its own.
 */
export class ClickHouseSchemaLock {
  static create(options: ClickHouseSchemaLockOptions = {}): ClickHouseSchemaLock {
    return new ClickHouseSchemaLock(
      options.lockPath ?? DEFAULT_CLICKHOUSE_SCHEMA_LOCK_PATH,
      options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      options.abandonedAfterMs ?? DEFAULT_ABANDONED_AFTER_MS,
      options.onBeforeClaim,
    );
  }

  private depth = 0;
  private heldToken: string | undefined;
  private readonly releaseOnProcessExit = () => {
    if (this.heldToken !== undefined) this.unlinkOwnLock();
  };

  private constructor(
    /** Where the lock lives, for error messages and tests. */
    readonly path: string,
    private readonly waitTimeoutMs: number,
    private readonly pollIntervalMs: number,
    private readonly abandonedAfterMs: number,
    private readonly onBeforeClaim: (() => void) | undefined,
  ) {}

  /**
   * Waits for the lock and returns its release. Re-entrant within one
   * instance: a suite holding it for a whole file still replays migrations
   * inside its own tests, and only the outermost release frees it.
   */
  async acquire(): Promise<() => void> {
    if (this.depth > 0) {
      this.depth++;
      return this.releaseOnce();
    }

    const deadline = Date.now() + this.waitTimeoutMs;
    for (;;) {
      const token = randomUUID();
      if (this.tryClaimLock(token)) {
        this.heldToken = token;
        this.depth = 1;
        process.on("exit", this.releaseOnProcessExit);
        return this.releaseOnce();
      }

      this.recoverIfAbandoned();

      if (Date.now() > deadline) throw this.timedOutWaiting();
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private claimPathFor(token: string): string {
    return `${this.path}.recovery.${token}`;
  }

  private readOwner(path: string): LockOwner {
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
  private olderThanAbandonThreshold(): boolean {
    try {
      return Date.now() - statSync(this.path).mtimeMs > this.abandonedAfterMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  /**
   * The current owner, when this process may remove it. A live owner is never
   * returned: the mtime is when the lock was taken, not when it was last
   * touched, so recovering on age would evict a suite mid-section.
   */
  private abandonedOwner(): { token: string } | undefined {
    const observed = this.readOwner(this.path);
    if (observed.state === "absent") return undefined;
    if (observed.state === "unreadable") {
      if (this.olderThanAbandonThreshold()) unlinkIfPresent(this.path);
      return undefined;
    }
    if (isProcessAlive(observed.pid)) return undefined;
    return { token: observed.token };
  }

  /**
   * Claims the right to remove one specific owner, then removes it. Unlinking
   * by pathname is unsafe: the holder can release and a new holder acquire in
   * between. Ownership therefore carries a token.
   */
  private removeLockOwnedBy(token: string): void {
    // `link` fails when the destination exists, so exactly one waiter can hold
    // the claim for a given token, and the claim names the owner rather than a
    // moment in time.
    const claimPath = this.claimPathFor(token);
    this.onBeforeClaim?.();
    try {
      linkSync(this.path, claimPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EEXIST: another waiter already claims this owner. ENOENT: the lock
      // went away while we looked at it, which is the outcome we wanted.
      if (code === "EEXIST" || code === "ENOENT") return;
      throw error;
    }

    try {
      // A hard kill between the claim and the unlink below wedges this one
      // lock, surfacing as the acquire timeout naming both paths. Deliberate: a
      // stuck run that says so beats two migrations rebuilding one table.
      const claimed = this.readOwner(claimPath);
      // A different token means the lock changed hands before the link, so
      // the inode now at `path` belongs to someone we never inspected.
      if (claimed.state === "held" && claimed.token === token) {
        unlinkIfPresent(this.path);
      }
    } finally {
      unlinkIfPresent(claimPath);
    }
  }

  private recoverIfAbandoned(): void {
    const abandoned = this.abandonedOwner();
    if (abandoned) this.removeLockOwnedBy(abandoned.token);
  }

  private timedOutWaiting(): Error {
    const owner = this.readOwner(this.path);
    const holder =
      owner.state === "held"
        ? `, held by pid ${owner.pid}. If that process is gone, a recovery claim may have been left at ${this.claimPathFor(owner.token)}; removing both files unblocks the run.`
        : ".";
    return new Error(
      `timed out after ${this.waitTimeoutMs}ms waiting for the ClickHouse schema lock at ${this.path}${holder}`,
    );
  }

  private tryClaimLock(token: string): boolean {
    let handle: number;
    try {
      handle = openSync(this.path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      writeSync(handle, `${token} ${process.pid} ${new Date().toISOString()}\n`);
    } catch (error) {
      unlinkIfPresent(this.path);
      throw error;
    } finally {
      closeSync(handle);
    }
    return true;
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.depth--;
      if (this.depth > 0) return;

      const owner = this.readOwner(this.path);
      this.depth = 0;
      const wasHeldToken = this.heldToken;
      this.heldToken = undefined;
      process.removeListener("exit", this.releaseOnProcessExit);
      // Releasing a lock that is no longer ours would hand a second holder's
      // critical section away. It cannot happen under the protocol above, so
      // if it ever does, say so rather than compound it.
      if (owner.state === "held" && owner.token !== wasHeldToken) {
        throw new Error(
          `the ClickHouse schema lock at ${this.path} is held by pid ${owner.pid} under a different token; this process never released it and something removed it early`,
        );
      }
      unlinkIfPresent(this.path);
    };
  }

  /**
   * Removes the lock only while it still carries our token, so a process
   * exiting after its lock was taken away cannot free the new holder's.
   */
  private unlinkOwnLock(): void {
    const owner = this.readOwner(this.path);
    if (owner.state === "held" && owner.token !== this.heldToken) return;
    unlinkIfPresent(this.path);
  }
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
