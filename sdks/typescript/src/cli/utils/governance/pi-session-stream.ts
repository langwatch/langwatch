/**
 * Reading one pi session file repeatedly, while pi is still writing it.
 *
 * Rung 8 (`pi-session-file.ts`) parses a whole file. Rung 9
 * (`pi-turn-events.ts`) turns rows into events. Neither remembers anything
 * between calls, so calling either on a poll loop would re-send the whole
 * session every pass. This holds the state that makes repeated passes add up to
 * the session exactly once: where in each file we have got to, and which rows
 * we have already emitted.
 *
 * Five decisions are load-bearing, the first four measured against pi's
 * shipped `SessionManager` rather than read from its documentation
 * (ADR-132 §2, §8).
 *
 * **The size is re-checked every pass; a remembered offset is never trusted on
 * its own.** A current-version file only ever grows — three runs against one
 * session, same inode, 1400 → 2274 → 3150 bytes, each earlier state a
 * byte-exact prefix of the next. The one exception is a file written by an
 * older pi: opening it runs a migration that truncates and rewrites in place
 * (measured 874 → 869 bytes, same inode), once, before any new turn. So an
 * offset can be past the end of a file that is still perfectly valid.
 *
 * **A file that shrank was replaced, not truncated.** We re-read it from zero
 * and keep the seen-set. That is the only ordering right in both directions:
 * the rewrite keeps the session id and the row ids, so every row it replays is
 * already in the set and emits nothing, while dropping the set would send the
 * whole session a second time — which is exactly what treating it as a brand
 * new file would do. What the re-read costs is one pass over a file we have
 * mostly seen; what it buys is an offset that points at a real line boundary
 * again, so the next append reads as a row rather than as the middle of one.
 *
 * **The offset only ever lands just past a newline.** pi appends whole lines,
 * but a pass can arrive between the write of a line's first half and its
 * second, and a session killed mid-write leaves that half on disk for good. So
 * a pass consumes bytes only as far as the last newline in what it read and
 * leaves the rest unread — which is what lets a torn line be completed later
 * and emitted then, and what makes emitting half a row impossible. Dropping the
 * torn line is rung 8's job; not swallowing the bytes under it is this
 * module's.
 *
 * **De-duplication keys on the pair (session id, row id).** Row ids are unique
 * within a file and not across files: `createBranchedSession` copies the
 * parent's row ids into the child verbatim, so a fork's inherited rows carry
 * the parent's ids under a different session id. Keying on the row id alone
 * would drop a branch's entire inherited history — silently, because a
 * swallowed row looks exactly like a row pi never wrote. The header line is not
 * a row, carries no row id of its own, and never enters the set: rung 8's
 * parser hands it back separately from `rows`, and the fallback key for a row
 * pi wrote without an id is positional, never the session id.
 *
 * **A pass reads a bounded window, not the whole unread range.** Steady-state
 * passes are small because pi has appended little, but the first pass on a
 * resumed session starts at zero and would otherwise size itself to the file.
 * See {@link MAX_READ_BYTES} — the remainder is not skipped, it is the next
 * pass's window.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { open, stat } from "node:fs/promises";

import type { PiRow, PiSessionHeader } from "./pi-session-file";
import { parsePiSessionFile } from "./pi-session-file";
import type { PiLineage } from "./pi-session-lineage";
import { buildPiTurnEvents, type PiTurnEvent } from "./pi-turn-events";

const NEWLINE = 0x0a;

/**
 * The separator between the two halves of a de-duplication key. A space,
 * because neither half can contain one: a session id is a UUID and a row id is
 * eight hex characters.
 */
const KEY_SEPARATOR = " ";

/**
 * The most one pass will read, and therefore parse, in one go.
 *
 * Every pass but the first reads only what pi appended since the last one, so
 * the size of a pass is normally a turn or two. The first pass on a file is the
 * exception: it starts at offset zero, and `pi-capture.ts` offers any session
 * the run touched, so a `pi --session` resume of an old conversation hands this
 * a whole file. Without a ceiling that pass allocates the file, then a string
 * of it, then a line array of it — parsing runs on whatever the read returned,
 * so all three scale together.
 *
 * The ceiling costs nothing the module was not already doing: chunk-at-a-time
 * parsing is the steady state here, and this only makes the first pass behave
 * like the rest. Nothing is dropped either, because the offset advances by what
 * was consumed and the remainder is read next pass, in order.
 *
 * 8 MiB against a measured 407 KiB for the largest real session on hand, whose
 * longest single row was 34 KiB. So the cap is two orders of magnitude clear of
 * a session that exists and 240x clear of a row that exists: in practice it
 * never engages, and it is here for the resumed session nobody has measured.
 */
const MAX_READ_BYTES = 8 * 1024 * 1024;

/** Where one file has got to. One per path, for the life of the stream. */
interface FileCursor {
  /**
   * Bytes consumed so far. Always either 0 or one past a newline, so a read
   * that starts here starts at the beginning of a line.
   */
  offset: number;
  /**
   * The header, kept from the pass that read the file's first line. Later
   * passes read only appended bytes and so never see it again, and every event
   * is keyed by the session id it carries.
   */
  header: PiSessionHeader | null;
  /**
   * Rows consumed so far, counting the ones skipped as duplicates. Used only to
   * key a row pi wrote without an id, where position in the file is the only
   * identity there is.
   */
  rowsConsumed: number;
  /**
   * Where this session came from, resolved once — on the pass that first read
   * the header — and reused by every later pass. `undefined` means not yet
   * resolved, which is not the same as a resolved absence: resolving costs a
   * read of a file we were not asked to open, so doing it per pass would open
   * the parent once per poll tick for the life of the session.
   *
   * Deliberately NOT cleared by the shrink branch below. A file that shrank was
   * rewritten in place keeping its header, so re-resolving would open the
   * parent again to arrive at the same answer.
   */
  lineage: PiLineage | undefined;
  /**
   * Whether the resolver has been called for this file yet, win or lose.
   *
   * Separate from {@link FileCursor.lineage} because a resolver that threw
   * leaves three states to tell apart, not two: not yet asked, asked and
   * answered, and asked and failed. Collapsing the third into `undefined` would
   * retry the throwing resolver on every poll tick for the life of the session,
   * which is the per-tick I/O the cache exists to prevent. Collapsing it into
   * {@link NO_LINEAGE} would be worse: that value asserts `isFork: false`, and a
   * resolver that threw told us nothing about whether this session is a fork.
   *
   * Cleared by nothing, for the same reason `lineage` is not.
   */
  isLineageResolved: boolean;
}

/**
 * A reader that can be asked for the same file again and again.
 *
 * The seen-set is shared across every file the stream reads, which is what
 * makes the session half of the key do any work: two files whose rows share ids
 * are kept apart only because both halves are in the key. It grows with the
 * number of rows the process has seen — tens of bytes per row, for the life of
 * one wrapped coding session — and is not pruned, because any later pass can
 * offer a row again and forgetting it would re-send it.
 */
export interface PiSessionStream {
  /**
   * The events this file has gained since the last call, in file order.
   *
   * Empty, and never an error, for: a file that does not exist yet (pi defers
   * its first write to the first assistant reply), a file nothing has appended
   * to, a file whose first line is not a session header, and a pass that
   * arrived with only half a line of new bytes on disk.
   */
  read(path: string): Promise<PiTurnEvent[]>;
}

/**
 * The identity a row is de-duplicated under.
 *
 * A row pi wrote without an id — a v1 file predates row ids entirely — falls
 * back to its position in the file, which is stable for a file that only
 * appends. The one case the fallback gets wrong is a v1 file migrated
 * mid-session: the rewrite gives every row an id, so the positional keys stop
 * matching and those rows are emitted a second time. A bounded, once-per-old
 * file over-count, against an unbounded under-count if idless rows were dropped
 * instead.
 */
function rowKey({
  sessionId,
  row,
  position,
}: {
  sessionId: string;
  row: PiRow;
  position: number;
}): string {
  return `${sessionId}${KEY_SEPARATOR}${row.id ?? `#${position}`}`;
}

/** Bytes `[from, to)` of a file, or null if it cannot be read. */
async function readRange({
  path,
  from,
  to,
}: {
  path: string;
  from: number;
  to: number;
}): Promise<Buffer | null> {
  const length = to - from;
  if (length <= 0) return Buffer.alloc(0);
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, from);
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {
      /* the read is done; a failed close changes nothing we return */
    });
  }
}

/**
 * Start a reader for one wrapped coding session.
 *
 * One stream per process rather than one per file: the state it holds is
 * exactly what two files with colliding row ids need in common.
 */
export interface PiSessionStreamOptions {
  /**
   * Resolve one session's lineage from its header.
   *
   * Injected rather than imported, so the reader keeps the property its module
   * note claims — it does no I/O beyond its own cursor — while the answer is
   * still computed where the header is known, which is here and nowhere else.
   * Called at most ONCE per file, on the pass that first reads the header.
   * Omitted, no lineage is stamped at all, which is the honest reading that
   * nothing was looked up.
   *
   * Expected not to throw: `resolvePiLineage` reports every way of failing as a
   * blank parent, and a rejection here would take the whole pass down with it.
   */
  resolveLineage?: (header: PiSessionHeader) => Promise<PiLineage>;
  /**
   * Overridable so a test can cross {@link MAX_READ_BYTES} without writing a
   * file of that size.
   */
  maxBytesPerRead?: number;
}

export function createPiSessionStream({
  resolveLineage,
  maxBytesPerRead = MAX_READ_BYTES,
}: PiSessionStreamOptions = {}): PiSessionStream {
  const cursors = new Map<string, FileCursor>();
  const seen = new Set<string>();

  return {
    async read(path: string): Promise<PiTurnEvent[]> {
      let size: number;
      try {
        size = (await stat(path)).size;
      } catch {
        // No file, or one we may not read. Both are ordinary (ADR-132 §2) and
        // neither is worth an error on a capture path.
        return [];
      }

      let cursor = cursors.get(path);
      if (!cursor) {
        cursor = {
          offset: 0,
          header: null,
          rowsConsumed: 0,
          lineage: undefined,
          isLineageResolved: false,
        };
        cursors.set(path, cursor);
      }

      // Smaller than what we have already consumed means the file was replaced
      // under us, not appended to. Start again from the top; the seen-set is
      // what stops the replay being sent twice.
      if (size < cursor.offset) {
        cursor.offset = 0;
        cursor.header = null;
        cursor.rowsConsumed = 0;
      }
      if (size === cursor.offset) return [];

      // A window, not the whole unread range. See {@link MAX_READ_BYTES}: the
      // rest of the file is not skipped, it is next pass's window.
      const windowEnd = Math.min(size, cursor.offset + maxBytesPerRead);
      let buffer = await readRange({ path, from: cursor.offset, to: windowEnd });
      if (buffer === null || buffer.length === 0) return [];

      // Consume up to and including the last newline. Anything after it is a
      // line pi has not finished writing, or one it never will; either way the
      // bytes stay unread so a later pass can see them whole.
      let lastNewline = buffer.lastIndexOf(NEWLINE);
      if (lastNewline === -1 && windowEnd < size) {
        // A whole window of one line: pi wrote a row longer than the cap. The
        // window cannot advance past it, and every later pass would read the
        // same newline-free bytes and consume nothing — a file stalled for
        // good, silently. So the ceiling yields to the allocation it exists to
        // avoid rather than to a lost session.
        buffer = await readRange({ path, from: cursor.offset, to: size });
        if (buffer === null || buffer.length === 0) return [];
        lastNewline = buffer.lastIndexOf(NEWLINE);
      }
      if (lastNewline === -1) return [];
      const complete = buffer.subarray(0, lastNewline + 1);
      cursor.offset += complete.length;

      const parsed = parsePiSessionFile(complete.toString("utf8"));
      cursor.header ??= parsed.header;

      const header = cursor.header;
      const sessionId = header?.sessionId;
      if (!header || !sessionId) {
        // Not a pi session file, or not one yet. The bytes are consumed either
        // way: the header is pi's first line, so a chunk that started at zero
        // without one is a file that will never have one.
        return [];
      }

      // After the session id is known and before any event is built. Every
      // event carries the lineage attributes, so resolving any later would
      // stamp the first pass's events blank and every pass after it filled —
      // for the same session, on the same run.
      if (resolveLineage && !cursor.isLineageResolved) {
        cursor.isLineageResolved = true;
        try {
          cursor.lineage = await resolveLineage(header);
        } catch {
          // The transcript outranks the enrichment. Lineage is an attribute on
          // events whose content is already in hand; a resolver that throws
          // must cost those attributes and nothing else, so the pass carries on
          // and stamps no lineage — the same honest reading as a stream built
          // with no resolver at all: nothing was looked up.
          //
          // Silent by decision, not by omission. This is the reader the wrapper
          // polls while pi owns the terminal, so a line on stderr here would
          // land in the middle of somebody's session, once per broken resolver,
          // to report the loss of an attribute they cannot act on. ADR-132 §2
          // settles the same trade the same way for the harvest loop.
          //
          // `resolvePiLineage` reports every failure as a blank parent and so
          // never reaches this, which is exactly why the catch is here: the
          // resolver is injected, and the contract that `read` never throws
          // cannot rest on the care taken inside one implementation of it.
          cursor.lineage = undefined;
        }
      }

      const fresh: PiRow[] = [];
      for (const row of parsed.rows) {
        const key = rowKey({ sessionId, row, position: cursor.rowsConsumed });
        cursor.rowsConsumed++;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(row);
      }

      return buildPiTurnEvents({
        session: {
          ...parsed,
          header,
          rows: fresh,
        },
        lineage: cursor.lineage,
      });
    },
  };
}
