/**
 * Posting a running pi session to LangWatch, one poll pass at a time.
 *
 * `pi-session-stream.ts` turns repeated reads of one file into that file's new
 * events. This turns that into capture for a whole run: which files to offer
 * it, what to do with the events, and what to do when the post fails. It is
 * pi's answer to `codex-rollout-otlp.ts`'s `createCodexIOStreamer`, and the
 * wrapper drives it with the same poll-then-final-sweep shape.
 *
 * Three decisions are load-bearing.
 *
 * **Only sessions this run touched.** The directory holds every pi session the
 * user has ever had. A file whose last modification predates the run is one pi
 * was not writing while we were watching, and capturing it would ship a
 * conversation the user never launched through us (ADR-132 §2: a plain `pi`
 * typed into a shell is out of scope, tracked as #8132). The comparison is
 * against the run's start, stamped once before the child is spawned.
 *
 * The window has one honest limit: a SECOND pi the user starts by hand, in
 * another terminal, while this run is going, also has a fresh modification time
 * and is captured too. pi writes no launching-process marker, so the alternative
 * on this axis is tightening to files created after the run started, which drops
 * every resumed session because a resumed file already existed.
 *
 * One narrowing does exist and is unused: the session header carries `cwd`, the
 * directory pi ran in (`pi-session-file.ts:100`). A hand-started pi in another
 * directory could be excluded on it. Nothing here reads it. Not done, not
 * impossible. #8132 is a different problem, and points the other way: it wants
 * plain `pi` runs captured, not excluded.
 *
 * **A failed post is retried, not swallowed.** The codex streamer marks a turn
 * emitted only after a successful post, so a transient failure retries on the
 * next tick. The pi stream cannot offer that: its de-duplication happens at
 * read time, and a row enters the seen-set before anything is sent. So a naive
 * wiring loses those turns for good on one refused or timed-out post — the same
 * silent loss the rest of this feature is written to avoid. Instead the events
 * are held here and prepended to the next pass. Bounded, because an endpoint
 * that is unreachable for an hour must not grow a buffer without limit.
 *
 * **Overflow says so.** A bounded buffer that drops quietly has not removed the
 * silent loss, only moved it behind a threshold — which is worse, because the
 * threshold is invisible. The first drop is announced on stderr and the exact
 * total is reported at exit, so a user whose session was too long for an outage
 * knows it happened and roughly when it started. Loud and lossy beats silent
 * and lossy: the user can act on the first, not the second.
 *
 * **The buffer is memory, not storage, and dies with the process.** If pi exits
 * while turns are pending and the final sweep also fails, those turns are gone.
 * That is a known and accepted limit of this rung — "buffered" here does not
 * mean "durable". Surviving a crash needs a spool on disk, which is a different
 * decision (it writes to the user's machine, which capture currently never
 * does) and belongs to its own change.
 *
 * **Never throws.** Every entry point resolves. A coding session must not fail,
 * stall, or print a stack trace because telemetry could not be delivered.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import {
  findFilesModifiedSince,
  postOtlpBody,
} from "./agent-rollout-transport";
import { lwTag } from "./brand";
import {
  createPiSessionStream,
  type PiSessionStream,
} from "./pi-session-stream";
import { resolvePiLineage } from "./pi-session-lineage";
import {
  buildPiEventsPayload,
  PI_AGENT_ID,
  type PiTurnEvent,
} from "./pi-turn-events";

/** The extension pi gives every session file. */
const SESSION_FILE_SUFFIX = ".jsonl";

/**
 * How many undelivered events to hold while the endpoint is unreachable.
 *
 * A busy hour of pi is on the order of hundreds of events, so this is roughly a
 * working day of backlog and still a few megabytes at most. Past it the oldest
 * go, because the alternative is a wrapper whose memory grows with the length
 * of an outage.
 */
const MAX_PENDING_EVENTS = 20_000;

/**
 * How far before the run's start a file may claim to have been modified and
 * still be offered to the reader.
 *
 * The run's start comes from `Date.now()`; a file's modification time comes
 * from the kernel, and on Linux the two do not have the same resolution. File
 * timestamps there advance in one-millisecond steps — 300 consecutive writes
 * produced 29 distinct mtimes, every gap exactly 1ms — while `Date.now()` is
 * not quantised to that step. A file written AFTER the stamp can therefore
 * carry an mtime up to a millisecond BEFORE it. Driving the shape this code
 * actually has, a few awaited hops and then one async write, Linux reported an
 * mtime earlier than the stamp in 373 of 400 runs; macOS in 0 of 400.
 *
 * So `mtime >= sinceMs` is not a sound question, and because this is a
 * whole-file filter, losing it means the run captures nothing at all, exits 0,
 * and says nothing — the failure has no symptom anywhere. That matches the
 * CI-only flake in `pi-wrapper-capture.unit.test.ts`, which fails on Linux and
 * never on macOS. Stated plainly: the flake was not reproduced here, and this
 * grace is not proven to be its only cause. The comparison is unsound on its
 * own terms, and that is the reason it is fixed.
 *
 * A grace is free here because this filter is not the run's boundary, only a
 * prefilter for it. `readTurnsSince` compares each row's own clock — pi's, not
 * the filesystem's — against the same `sinceMs`, and that comparison is what
 * makes "only this run's turns" true. Every row a widened file window lets
 * through is still dropped there. The cost is reading a session file the user
 * last touched in the second before launch and sending none of it.
 *
 * A second is a thousand of the one-millisecond steps that cause this, and
 * still far too short to reach a previous session of any real length.
 */
export const FS_CLOCK_SKEW_GRACE_MS = 1_000;

export interface PiCapture {
  /**
   * Read every session this run has touched and post what is new.
   *
   * Resolves to the number of events posted. Resolves to 0 on a failure — the
   * events are kept for the next call — so the caller never has to decide what
   * a rejection means.
   */
  harvest(): Promise<number>;
  /** Events read but not yet delivered. For tests and the exit report. */
  pendingCount(): number;
  /**
   * Events read, never delivered, and now discarded because the buffer filled.
   * Distinct from {@link PiCapture.pendingCount}: pending may still be sent,
   * dropped never will be.
   */
  droppedCount(): number;
}

/**
 * The session files worth offering the reader on this pass.
 *
 * The mtime window and the unreadable-directory rule are the shared walker's,
 * not a second copy of them: pi states its own flat layout and its own name
 * filter and takes the rest. An unreadable directory yields nothing, which is
 * what pi needs — it creates the directory on its first write, so "not there
 * yet" is the ordinary state at the start of every fresh session.
 */
async function sessionFilesTouchedSince({
  dir,
  sinceMs,
}: {
  dir: string;
  sinceMs: number;
}): Promise<string[]> {
  const touched = await findFilesModifiedSince({
    root: dir,
    // pi keeps its sessions in one flat directory, so the walk must not
    // descend. `maxDepth: 0` states that layout here, which is the whole
    // point of the shared walker taking it as an argument.
    maxDepth: 0,
    // Widened against the filesystem clock, never narrowed: see
    // FS_CLOCK_SKEW_GRACE_MS. The run's real boundary is the row window in
    // `readTurnsSince`, which this cannot loosen.
    sinceMs: sinceMs - FS_CLOCK_SKEW_GRACE_MS,
    matchesName: (name) => name.endsWith(SESSION_FILE_SUFFIX),
  });
  // The shared walker yields newest-name-first, which is what a caller
  // searching for one recent session wants. This caller posts all of them, in
  // the order they were created, so it re-sorts ascending rather than reading
  // a run's sessions backwards.
  return touched.sort();
}

/**
 * Every turn these files have gained that belongs to this run.
 *
 * Only turns this run produced. The reader's seen-set lives in memory and dies
 * with the process, so a RESUMED session is offered from its first row again on
 * the next run — the file's modification time moved, and the new process has no
 * memory of what an earlier one already sent. Nothing downstream removes the
 * repeat: the session fold sets `refoldOnOutOfOrder: false` because its
 * accumulators commute, and sums commute without deduplicating, so a re-sent
 * turn is ADDED to the cost and the call count rather than collapsing into the
 * turn already there. Filtering on the entry clock is what makes the file-level
 * "only what this run touched" rule true row by row, and it needs nothing kept
 * on disk.
 *
 * The accepted cost: a turn written before this run started is never captured,
 * so turns a crashed wrapped run never posted are not recovered by resuming it.
 * That loss is this module's existing position on a crash, not a new one.
 */
async function readTurnsSince({
  stream,
  paths,
  sinceMs,
}: {
  stream: PiSessionStream;
  paths: string[];
  sinceMs: number;
}): Promise<PiTurnEvent[]> {
  const turns: PiTurnEvent[] = [];
  for (const path of paths) {
    try {
      for (const event of await stream.read(path)) {
        if (event.timeUnixMs >= sinceMs) turns.push(event);
      }
    } catch {
      // The reader is documented not to throw; if a future change makes it,
      // one unreadable session must not cost the others their pass.
    }
  }
  return turns;
}

export interface PiCaptureOptions {
  /** The run's start. Sessions untouched since are left alone. */
  sinceMs: number;
  sessionsDir: string;
  /** The OTLP logs endpoint, spelled out — pi emits events, never spans. */
  logsEndpoint: string;
  token: string;
  scopeVersion?: string;
  fetchImpl?: typeof fetch;
  /** Overridable so a test can fill the buffer without 20,000 events. */
  maxPending?: number;
  /**
   * Where the overflow notice goes. Defaults to stderr rather than to a no-op
   * on purpose: a caller that forgets to pass one still gets a loud drop.
   *
   * Expected not to throw, and not trusted to keep that promise — see the call
   * site. It is injected, so the never-throws contract cannot rest on the care
   * taken inside any one implementation of it.
   */
  warn?: (message: string) => void;
}

/**
 * Start capture for one wrapped pi run.
 *
 * One stream for the whole run, not one per pass: the reader's cursors and its
 * seen-set are exactly the state that makes repeated passes add up to each
 * session once, and rebuilding it per pass would re-send every session every
 * time.
 */
export function createPiCapture({
  sinceMs,
  sessionsDir,
  logsEndpoint,
  token,
  scopeVersion = LANGWATCH_SDK_VERSION,
  fetchImpl,
  maxPending = MAX_PENDING_EVENTS,
  warn = (message) => void process.stderr.write(message),
}: PiCaptureOptions): PiCapture {
  const stream = createPiSessionStream({ resolveLineage: resolvePiLineage });
  let pending: PiTurnEvent[] = [];
  let dropped = 0;

  return {
    pendingCount: () => pending.length,
    droppedCount: () => dropped,

    async harvest(): Promise<number> {
      const paths = await sessionFilesTouchedSince({
        dir: sessionsDir,
        sinceMs,
      });

      // Undelivered events lead, so a session's turns keep the order pi wrote
      // them in across a failed pass.
      const batch = pending;
      pending = [];
      batch.push(...(await readTurnsSince({ stream, paths, sinceMs })));
      if (batch.length === 0) return 0;

      try {
        await postOtlpBody({
          body: buildPiEventsPayload({ events: batch, scopeVersion }),
          endpoint: logsEndpoint,
          token,
          tool: PI_AGENT_ID,
          fetchImpl,
        });
      } catch {
        // Refused, unreachable, or timed out. Hold them for the next pass; the
        // reader will not offer them again.
        pending = batch.slice(-maxPending);
        const lost = batch.length - pending.length;
        if (lost > 0) {
          // Announce the first overflow only. Every later failed pass drops
          // again, and a line every 2.5s for the length of an outage would bury
          // the terminal pi is running in. The exact total is reported at exit.
          if (dropped === 0) {
            try {
              warn(
                `${lwTag()} cannot reach LangWatch and the pi capture backlog is full; turns are now being discarded as they age out.\n`,
              );
            } catch {
              // The tally outranks the announcement, and both outrank the
              // contract's convenience. `warn` is injected — the default
              // writes to a stderr the wrapped session owns and may have
              // closed — so a throw here would leave `harvest` rejecting on
              // the one path where it is already failing, and the exit report
              // undercounting by exactly the turns it just discarded. The
              // caller loses the notice, never the number.
            }
          }
          dropped += lost;
        }
        return 0;
      }
      return batch.length;
    },
  };
}
