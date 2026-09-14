/**
 * Resolving where a pi session came from.
 *
 * pi records a split — `/fork`, `/clone`, `newSession({ parentSession })` — by
 * writing the parent's **file path** into the child's session header
 * (`parentSession`). It never writes the parent's id. So the only way to record
 * lineage as an identifier is to open that file and read the id out of its
 * first line, which is what this module does.
 *
 * Three properties drive the shape.
 *
 * **The path must never leave the machine.** `parentSession` is an absolute
 * filesystem path that starts with the user's home directory. The value we
 * stamp lands in `parentSessionId`, which the session fold sets ONCE and can
 * never correct (`coding-agent-session.derivation.ts:562`) — verified by
 * execution, along with the fact that a path-shaped value persists there
 * verbatim. Emitting the path would therefore ship a home directory path to the
 * server permanently. {@link PiLineage} carries the resolved id and nothing
 * else: the path is a parameter of this module's functions and is not a field
 * of anything it returns, so there is no value downstream can accidentally
 * stamp.
 *
 * **A parent present is what makes a session a branch.** pi does not
 * distinguish its several ways of splitting, and we do not invent a taxonomy
 * for it. {@link PiLineage.isFork} comes from the presence of the path, not
 * from reading the parent — so a parent whose file the user has since deleted
 * still marks the child a branch, with the parent left blank. Blank means "not
 * recovered", never "no parent".
 *
 * **Only the first line is read.** The parent is a file we were not asked to
 * capture and it can be megabytes of somebody's conversation. We open it, take
 * the header line, and stop. Loading the rest to reach a field on line one
 * would be both wasteful and a wider read than the job needs.
 *
 * Startup forks lose their lineage in process: `pi --fork` and `pi --session`
 * split before anything of ours runs, so the session reason is "startup" and
 * the file is the only place the parentage survives. That is why this reads the
 * JSONL rather than hooking pi.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";

import type { PiSessionHeader } from "./pi-session-file";

/**
 * Where a session came from, as identifiers only.
 *
 * Deliberately has no field for the parent's file path. See the module note:
 * the path is home-directory-shaped, and the fold it would land in is once-set
 * and uncorrectable.
 */
export interface PiLineage {
  /**
   * The parent session's own id, read out of the parent file's header. Null
   * when the session has no parent, and also when it has one whose file could
   * not be read — the two are told apart by {@link PiLineage.isFork}.
   */
  readonly parentSessionId: string | null;
  /**
   * This session was split off another. True from the mere presence of a
   * parent path, so it survives a parent whose file is gone.
   */
  readonly isFork: boolean;
}

/** A session that was not split off another. */
export const NO_LINEAGE: PiLineage = { parentSessionId: null, isFork: false };

/**
 * How much of the parent file to read looking for its first newline.
 *
 * A pi header line is around 150 bytes on the sessions measured. 64 KiB is
 * three orders of magnitude of headroom and still a bounded read of a file we
 * were not asked to open; a "header" longer than this is not a pi header.
 */
const MAX_HEADER_BYTES = 64 * 1024;

/**
 * The first line of a file, or null when there is nothing readable to take.
 *
 * Null covers a missing file, an unreadable one, an empty one, and one whose
 * first line is longer than {@link MAX_HEADER_BYTES}. All four end the same
 * way — the parent is not recovered — and none of them is worth an error on a
 * capture path.
 */
async function readFirstLine(path: string): Promise<string | null> {
  let handle;
  try {
    // O_NONBLOCK, not just "r": the path comes out of a file we did not write,
    // and `open(2)` on a FIFO with no writer — or on a stalled network mount —
    // blocks forever rather than failing. Measured: a plain open of a FIFO here
    // never returned and never threw, and because it blocks inside a libuv
    // threadpool thread it also wedges one of the four, so a handful of them
    // starve filesystem I/O process-wide. The reader awaits this inside a poll
    // pass with no timeout of its own, so a hang is worse than an error: an
    // error ends a tick, this ends capture. O_NONBLOCK is a no-op on regular
    // files, which is every parent we actually expect.
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.allocUnsafe(MAX_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_HEADER_BYTES, 0);
    if (bytesRead === 0) return null;
    const chunk = buffer.subarray(0, bytesRead);
    const newline = chunk.indexOf(0x0a);
    // No newline in the window: a file of one line and no terminator is a whole
    // header; a file that filled the window without one is not a pi file.
    if (newline === -1) {
      return bytesRead < MAX_HEADER_BYTES ? chunk.toString("utf8") : null;
    }
    return chunk.subarray(0, newline).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {
      /* the read is done; a failed close changes nothing we return */
    });
  }
}

/**
 * The session id on a pi header line, or null when the line is not one.
 *
 * Requires `type: "session"`: the id field on any other entry kind is a ROW id,
 * unique only within its file (ADR-132 §8), and stamping one as a parent
 * session id would be a permanent wrong answer in a once-set column.
 */
function sessionIdFromHeaderLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const entry = parsed as Record<string, unknown>;
  if (entry.type !== "session") return null;
  return typeof entry.id === "string" && entry.id.length > 0 ? entry.id : null;
}

/**
 * Resolve one session's lineage from its header.
 *
 * Never throws and never reports: every way the parent can fail to resolve —
 * no parent at all, a deleted file, an unreadable one, a first line that is not
 * a pi header — leaves the parent blank, and only the presence of a path
 * decides whether the session is marked a branch.
 *
 * Obligation on any resolver used here, this one included: never reject after
 * recovering a value. Return what was learned and swallow the cleanup failure —
 * which is why the close above is caught rather than awaited bare. A rejected
 * promise carries no value, so the caller cannot tell "failed to learn the
 * parent" from "learned it, then failed to clean up"; it records the pessimistic
 * answer, and that answer lands in a once-set column that is never retried. A
 * cleanup failure would therefore discard a parent already in hand, permanently.
 */
export async function resolvePiLineage(
  header: PiSessionHeader | null,
): Promise<PiLineage> {
  const parentPath = header?.parentSessionFile ?? null;
  if (parentPath === null || parentPath === "") return NO_LINEAGE;

  const line = await readFirstLine(parentPath);
  const parentSessionId = line === null ? null : sessionIdFromHeaderLine(line);
  return { parentSessionId, isFork: true };
}
