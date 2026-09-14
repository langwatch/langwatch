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
 * and is captured too. Narrowing it further needs an identity pi does not give
 * us — it writes no launching-process marker — so the choice is this
 * over-capture or dropping resumed sessions, whose files predate the run and
 * are the common case. #8132 is where the identity belongs.
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
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { LANGWATCH_SDK_VERSION } from "@/internal/constants";
import { postOtlpBody } from "./agent-rollout-transport";
import { lwTag } from "./brand";
import { createPiSessionStream } from "./pi-session-stream";
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
 * Sorted by name so a run with several sessions posts them in a stable order
 * rather than in whatever order the filesystem enumerates. An unreadable
 * directory yields nothing: pi creates it on its first write, so "not there
 * yet" is the ordinary state at the start of every fresh session.
 */
async function sessionFilesTouchedSince({
  dir,
  sinceMs,
}: {
  dir: string;
  sinceMs: number;
}): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const touched: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(SESSION_FILE_SUFFIX)) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (info.mtimeMs >= sinceMs) touched.push(path);
    } catch {
      // Vanished between the listing and the stat, or not ours to read.
      // Either way there is nothing to capture and nothing to report.
    }
  }
  return touched;
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
}: {
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
   */
  warn?: (message: string) => void;
}): PiCapture {
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
      for (const path of paths) {
        try {
          batch.push(...(await stream.read(path)));
        } catch {
          // The reader is documented not to throw; if a future change makes it,
          // one unreadable session must not cost the others their pass.
        }
      }
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
            warn(
              `${lwTag()} cannot reach LangWatch and the pi capture backlog is full; turns are now being discarded as they age out.\n`,
            );
          }
          dropped += lost;
        }
        return 0;
      }
      return batch.length;
    },
  };
}
