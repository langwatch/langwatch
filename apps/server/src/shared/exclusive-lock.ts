import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_POLL_MS = 500;

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/** Whether a process with this pid is running; EPERM means it is, under another user. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/** The pid a lock file names, or null when it is gone or unreadable. */
function holderOf(lockFile: string): number | null {
  try {
    const pid = Number(readFileSync(lockFile, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Links a file already holding our pid into place, so a holder never reads it half-written. */
function tryTake({ lockFile, pid }: { lockFile: string; pid: number }): boolean {
  const own = `${lockFile}.${pid}`;
  writeFileSync(own, String(pid), { mode: 0o600 });
  try {
    linkSync(own, lockFile);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(own, { force: true });
  }
}

/**
 * Runs `run` while this process alone holds `lockFile`. A lock naming a process that is no
 * longer running is stale and taken over; one held by a live process is waited on.
 */
export async function withExclusiveLock<T>({
  lockFile,
  onWait,
  run,
}: {
  lockFile: string;
  onWait?: (holder: number) => void;
  run: () => Promise<T>;
}): Promise<T> {
  mkdirSync(dirname(lockFile), { recursive: true });
  while (!tryTake({ lockFile, pid: process.pid })) {
    const holder = holderOf(lockFile);
    if (holder !== null && !isProcessAlive(holder)) {
      if (holderOf(lockFile) === holder) rmSync(lockFile, { force: true });
      continue;
    }
    if (holder !== null) onWait?.(holder);
    await sleep(LOCK_POLL_MS);
  }
  try {
    return await run();
  } finally {
    if (holderOf(lockFile) === process.pid) rmSync(lockFile, { force: true });
  }
}
