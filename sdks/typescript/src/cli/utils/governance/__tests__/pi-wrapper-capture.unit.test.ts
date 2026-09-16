/**
 * The wrapper actually starts pi's session reader, and posts what it reads.
 *
 * Everything below this seam — the reader, the event builder, the lineage
 * resolver — is covered by its own suite, and every one of those suites stays
 * green whether or not `runWrapped` ever calls any of it. So this drives the
 * REAL `runWrapped` against a REAL session file on disk and observes the REAL
 * request body, with only the boundaries stubbed: the child process, the config
 * and mode resolution, and `fetch`. Nothing between the wrapper and the wire is
 * mocked, which is the only arrangement in which "the wiring is connected" is
 * something a test can fail on.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENDPOINT = "https://app.langwatch.test/api/otel";
/** Mirrors `PI_SESSION_POLL_MS` in the wrapper, which is not exported. */
const PI_POLL_MS = 2_500;
const TOKEN = "sk-lw-ingest-test";

/**
 * The fake pi process, and the handles a test drives it by.
 *
 * Inside `vi.hoisted` because `vi.mock` factories are hoisted above every
 * top-level declaration in this file: a plain `const spawnMock` would not exist
 * yet when the mock for `node:child_process` is built.
 *
 * `writes` is what "pi" puts on disk while it runs. The session file has to
 * appear AFTER the wrapper stamps the run's start, since that stamp is the
 * whole of the "only what this run touched" rule — a fixture written during
 * setup has an older modification time and is correctly ignored, which is a
 * passing test that proves nothing.
 *
 * `close` ends the child, and `holdOpen` keeps it alive until a test says
 * otherwise. Without that, the child would exit at once, the final sweep would
 * send everything, and deleting the entire poll would still pass.
 */
const child = vi.hoisted(() => {
  const state: {
    writes: (() => Promise<void>) | null;
    close: (() => void) | null;
    holdOpen: boolean;
  } = { writes: null, close: null, holdOpen: false };
  const spawnMock = vi.fn(() => ({
    on(event: string, handler: (arg: unknown) => void) {
      if (event !== "close") return this;
      state.close = () => handler(0);
      if (!state.holdOpen) {
        void (async () => {
          await state.writes?.();
          state.close?.();
        })();
      }
      return this;
    },
  }));
  return { state, spawnMock };
});

vi.mock("node:child_process", () => ({ spawn: child.spawnMock }));

vi.mock("../config", () => ({
  loadConfig: () => ({ control_plane_url: "https://app.langwatch.test" }),
  isLoggedIn: () => true,
  saveConfig: () => undefined,
}));

vi.mock("../wrapper-mode", () => ({
  resolveWrapperMode: vi.fn(async () => ({
    mode: "ingestion",
    vars: {},
    clears: [],
    endpoint: ENDPOINT,
    ingestionToken: TOKEN,
  })),
}));

vi.mock("../wrapper-path-choice", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveWrapperPath: async () => ({ mode: "ingestion", isAborted: false }),
}));

vi.mock("../tool-env", () => ({ envForTool: () => ({ vars: {}, clears: [] }) }));
vi.mock("../cli-api", () => ({ getCliBootstrap: async () => null }));
vi.mock("../cli-location", () => ({ recordCliLocation: () => undefined }));
vi.mock("../claude-plugin", () => ({
  updateLangwatchClaudePlugin: () => ({ ok: true }),
}));
vi.mock("../shell-rc", () => ({
  SHELL_FUNCTION_TOOLS: [] as string[],
  maybeOfferIngestionShellRcPersist: async () => undefined,
}));
vi.mock("../../spinner", () => ({
  createSpinner: () => ({ start: () => undefined, stop: () => undefined }),
}));

// Static, not `await import`: vitest hoists every `vi.mock` above the imports,
// so the mocks are already in place, and the repo bans inline `import()`
// outside the CLI's own boot path.
import { resolveWrapperMode } from "../wrapper-mode";
import { drainPiCapture, runWrapped } from "../wrapper";
import type { PiCapture } from "../pi-capture";

const OWN_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const UNTOUCHED_ID = "33333333-3333-4333-8333-333333333333";

function headerLine({
  id,
  parentSession,
}: {
  id: string;
  parentSession?: string;
}): string {
  return JSON.stringify({
    type: "session",
    id,
    version: 3,
    createdAt: "2026-09-14T10:00:00.000Z",
    ...(parentSession ? { parentSession } : {}),
  });
}

/**
 * A turn stamped when it is written, which is while the run is in progress.
 *
 * These rows are written by the fake child during `launchPi()`, so their clock
 * has to be the run's clock. Capture keeps only turns at or after the run's
 * start — that row-level window is what stops a resumed session from being
 * billed twice — so a row frozen at a fixed past instant would be correctly
 * discarded as another run's work and these tests would assert on an empty
 * wire.
 */
function assistantRow(id: string): string {
  const now = new Date().toISOString();
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: now,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.parse(now),
      model: "openai/gpt-5-mini",
    },
  });
}

/**
 * What to print beside any failed assertion about the wire.
 *
 * An empty wire has several causes that are indistinguishable from the outside
 * of `posted`, and each one announces itself somewhere else: a run that never
 * reached the final sweep leaves a non-zero code in `exitCalls`; capture that
 * was never started for want of an endpoint says so on stderr
 * (`wrapper.ts:936`); a sweep cut off by its deadline says so too
 * (PI_FINAL_SWEEP_DEADLINE_MS). Without them, a failure here reads
 * `expected '' to contain ...` and names none of the three - which is exactly
 * what one CI-only failure of this file left behind, and the reason the cause
 * had to be hunted rather than read.
 */
function why(): string {
  return [
    `posts=${posted.length}`,
    `exits=${JSON.stringify(exitCalls)}`,
    `stderr=${JSON.stringify(stderrText())}`,
  ].join(" ");
}

let dir: string;
let posted: string[];
let exitCalls: number[];
/** Everything the run wrote to stderr, joined. */
let said: string[];

function stderrText(): string {
  return said.join("");
}

/** Every request body the run put on the wire, as text. */
function wire(): string {
  return posted.join("\n");
}

/** How many event records reached the wire, across every post. */
function recordsSent(): number {
  return posted.reduce((total, body) => {
    const payload = JSON.parse(body) as {
      resourceLogs?: { scopeLogs?: { logRecords?: unknown[] }[] }[];
    };
    const records = payload.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords;
    return total + (records?.length ?? 0);
  }, 0);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-wrapper-"));
  posted = [];
  exitCalls = [];
  said = [];
  child.state.writes = null;
  child.state.close = null;
  child.state.holdOpen = false;
  child.spawnMock.mockClear();
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;

  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    _url: unknown,
    init?: { body?: string },
  ) => {
    if (init?.body) posted.push(init.body);
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch);

  // `runWrapped` returns `never` — it ends the process. Turn that into a throw
  // the test can catch, so the assertions run against a completed launch.
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    exitCalls.push(code);
    throw new Error(`__exit__${code}`);
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    said.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  await rm(dir, { recursive: true, force: true });
});

/**
 * Wait for a condition, failing with what it was waiting for.
 *
 * Named in the failure because a bare timeout on a poll test reads as
 * flakiness, when the thing it usually means is that the poll is gone.
 */
async function waitUntil(
  done: () => boolean,
  what: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Run the wrapper to completion, swallowing the stubbed `process.exit`. */
async function launchPi(): Promise<void> {
  await runWrapped("pi", []).catch((err: Error) => {
    if (!err.message.startsWith("__exit__")) throw err;
  });
}

describe("given a pi session launched through the wrapper", () => {
  describe("when the session runs", () => {
    /** @scenario "A session with no virtual key is captured from the file" */
    it("reads the session file and posts its turns", async () => {
      child.state.writes = async () => {
        await writeFile(
          join(dir, "own.jsonl"),
          `${headerLine({ id: OWN_ID })}\n${assistantRow("aaaaaaaa")}\n`,
          "utf8",
        );
      };

      await launchPi();

      expect(exitCalls, why()).toEqual([0]);
      // The reader ran and its output reached the wire: not that a factory was
      // called, but that this session's own id is in a posted body.
      expect(posted.length, why()).toBeGreaterThan(0);
      expect(wire(), why()).toContain(OWN_ID);
    });

    /**
     * Lineage is resolved for the running session and stamped on the wire.
     *
     * `resolvePiLineage` has five bound scenarios of its own and every one of
     * them passes with the resolver wired to nothing at all, because they all
     * call it directly. This one cannot: the only lineage in it comes from
     * whatever `runWrapped` chose to hand the reader.
     *
     * The annotation closes this comment on purpose. `isFollowedByTestCall`
     * (check-feature-parity.ts:1151) walks forward from the end of the match
     * and cannot leave a comment it starts inside: left on its own line, the
     * walk meets the `*` of the closing delimiter, fails the test-call match
     * and binds nothing, with no diagnostic.
     *
     * @scenario "A session split off another records where it came from" */
    it("stamps the parent that only the wrapper could have resolved", async () => {
      const parentPath = join(dir, "parent.jsonl");
      // The parent predates the run, as a real parent always does — it is read
      // for its id, never captured.
      await writeFile(parentPath, `${headerLine({ id: PARENT_ID })}\n`, "utf8");
      child.state.writes = async () => {
        await writeFile(
          join(dir, "child.jsonl"),
          `${headerLine({ id: OWN_ID, parentSession: parentPath })}\n` +
            `${assistantRow("bbbbbbbb")}\n`,
          "utf8",
        );
      };

      await launchPi();

      // Asserted before the lineage claims below, because a run that ended any
      // other way never reached the sweep that posts them, and "no parent on
      // the wire" would be a true statement about a run that captured nothing.
      expect(exitCalls, why()).toEqual([0]);
      expect(wire(), why()).toContain("parent_session_id");
      expect(wire(), why()).toContain(PARENT_ID);
      expect(wire(), why()).toContain("is_fork");
      // The parent's PATH is what pi wrote and what must never leave the
      // machine; only the id it resolves to may.
      expect(wire()).not.toContain(parentPath);
    });

    /** @scenario "A pi session LangWatch did not launch is left alone" */
    it("leaves a session this run never touched out of what it sends", async () => {
      const untouched = join(dir, "untouched.jsonl");
      await writeFile(
        untouched,
        `${headerLine({ id: UNTOUCHED_ID })}\n${assistantRow("cccccccc")}\n`,
        "utf8",
      );
      // The user's own `pi`, run yesterday. Its file predates this launch.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await utimes(untouched, yesterday, yesterday);

      child.state.writes = async () => {
        await writeFile(
          join(dir, "own.jsonl"),
          `${headerLine({ id: OWN_ID })}\n${assistantRow("dddddddd")}\n`,
          "utf8",
        );
      };

      await launchPi();

      // Both halves, or this passes when nothing was captured at all - and the
      // exit code first, so a run that never reached the sweep says so instead
      // of failing as a missing id.
      expect(exitCalls, why()).toEqual([0]);
      expect(wire(), why()).toContain(OWN_ID);
      expect(wire(), why()).not.toContain(UNTOUCHED_ID);
    });

    /**
     * Turns reach LangWatch while pi is still running, not only at exit.
     *
     * Deliberately observed BEFORE the child closes. Every other test here
     * would pass with the poll deleted entirely, because the final sweep sends
     * whatever the poll missed — so without this one the interval, its
     * `inFlight` skip and its `unref` are all unfalsifiable.
     *
     * Unbound: no scenario in the feature file describes streaming cadence.
     */
    it("posts a turn on a poll tick, before the session has ended", async () => {
      child.state.holdOpen = true;
      const run = launchPi();

      await waitUntil(() => child.state.close !== null, "the child to be spawned");
      await writeFile(
        join(dir, "own.jsonl"),
        `${headerLine({ id: OWN_ID })}\n${assistantRow("eeeeeeee")}\n`,
        "utf8",
      );

      // Real time, because the poll reads the filesystem and fake timers do not
      // advance real I/O completion. One interval is the cost of proving the
      // interval exists.
      await waitUntil(() => wire().includes(OWN_ID), "the poll to post the turn");
      // Asserted while the session is still running: nothing has closed yet.
      expect(posted.length).toBeGreaterThan(0);

      child.state.close?.();
      await run;
    });

    /**
     * Two passes never run at once, however slow a pass is.
     *
     * This is the expensive test in the file and it is deliberate. The overlap
     * skip is the one line here whose absence is invisible: the reader's
     * seen-set still stops anything being sent twice, so a duplicate-count
     * assertion passes either way. What actually breaks is the cursor — two
     * interleaved passes each add the same chunk length to the same offset
     * (`pi-session-stream.ts:210`), so it ends up past the end of the file and
     * every later append is skipped until the file shrinks and it resets.
     * Turns are lost, and then it silently heals.
     *
     * Observing that needs a pass still running when the next tick arrives,
     * which needs real time: a slow post, and new rows appended in between so
     * the second tick has work to do and would really call out.
     *
     * Unbound: no scenario describes poll overlap.
     */
    it("skips a tick while the previous pass is still running", async () => {
      child.state.holdOpen = true;
      let concurrent = 0;
      let maxConcurrent = 0;
      let releaseSlowPost: (() => void) | null = null;

      vi.mocked(globalThis.fetch).mockImplementation((async (
        _url: unknown,
        init?: { body?: string },
      ) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        if (init?.body) posted.push(init.body);
        // The first post hangs until the test lets it go, spanning the tick
        // after it. Later posts return at once.
        if (releaseSlowPost === null) {
          await new Promise<void>((resolve) => {
            releaseSlowPost = resolve;
          });
        }
        concurrent--;
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch);

      const run = launchPi();
      await waitUntil(() => child.state.close !== null, "the child to be spawned");

      const own = join(dir, "own.jsonl");
      await writeFile(
        own,
        `${headerLine({ id: OWN_ID })}\n${assistantRow("11111111")}\n`,
        "utf8",
      );
      await waitUntil(() => posted.length === 1, "the first pass to start");

      // A new turn while the first post is still hanging, so the next tick has
      // something to send and its skip is a real decision, not an empty pass.
      // Newline-terminated, or the reader correctly holds it back as a line pi
      // has not finished writing and the tick has nothing to skip.
      await writeFile(own, `${assistantRow("22222222")}\n`, { flag: "a" });
      await new Promise((resolve) => setTimeout(resolve, PI_POLL_MS + 500));

      expect(maxConcurrent).toBe(1);

      (releaseSlowPost as unknown as () => void)?.();
      child.state.close?.();
      await run;
      // The skipped tick delayed the second turn; it did not drop it. Counted
      // as records, because a row id is not something pi's events carry.
      expect(recordsSent()).toBe(2);
    }, 20_000);

    /**
     * The exit sweep waits for the tick it is exiting on top of.
     *
     * The tick guard above cannot cover this one: it lives inside the interval
     * callback, and the final sweep is not a tick. `clearInterval` retires the
     * timer and leaves whatever a tick already started still running, so the
     * two overlap on the way out — and the way out is where it costs most.
     * These are the last turns of the session, the process is about to exit,
     * and the loss report is read from counters the running pass has not
     * written to yet.
     *
     * Asserted as concurrency rather than as a lost turn, for the same reason
     * the tick test is: the reader's own de-duplication hides most of the
     * damage from a count, so a records assertion goes green either way. What
     * is unambiguous is whether two passes were on the wire at once.
     *
     * Unbound: no scenario describes the exit sweep's overlap with a poll.
     */
    it("waits for a running poll pass before the final sweep", async () => {
      child.state.holdOpen = true;
      let concurrent = 0;
      let maxConcurrent = 0;
      let releaseSlowPost: (() => void) | null = null;

      vi.mocked(globalThis.fetch).mockImplementation((async (
        _url: unknown,
        init?: { body?: string },
      ) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        if (init?.body) posted.push(init.body);
        // The tick's post hangs across the child's exit, which is the whole
        // arrangement: without it the pass is over before the sweep starts and
        // there is nothing to overlap.
        if (releaseSlowPost === null) {
          await new Promise<void>((resolve) => {
            releaseSlowPost = resolve;
          });
        }
        concurrent--;
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch);

      const run = launchPi();
      await waitUntil(() => child.state.close !== null, "the child to be spawned");

      const own = join(dir, "own.jsonl");
      await writeFile(
        own,
        `${headerLine({ id: OWN_ID })}\n${assistantRow("33333333")}\n`,
        "utf8",
      );
      await waitUntil(() => posted.length === 1, "the tick's pass to start");

      // A turn the tick's pass has already read past, so the final sweep has
      // real work and its post is a real second request rather than a pass
      // that finds nothing and returns early.
      await writeFile(own, `${assistantRow("44444444")}\n`, { flag: "a" });

      // pi exits while that post is still hanging.
      child.state.close?.();
      // Long enough for an unguarded sweep to have walked the directory, read
      // the appended turn and put it on the wire alongside the hanging post.
      await new Promise((resolve) => setTimeout(resolve, 750));

      expect(maxConcurrent).toBe(1);

      // Released only now, so the guarded sweep can finish and the run end.
      (releaseSlowPost as unknown as () => void)?.();
      await run;
      // Waiting delayed the appended turn; it did not drop it.
      expect(recordsSent()).toBe(2);
    }, 20_000);

    /**
     * The final sweep gives up rather than holding the terminal.
     *
     * The wait added by the test above is unbounded on its own. pi has already
     * exited by the time it runs, so the shell is sitting there waiting on
     * this process for its prompt, and the sweep's `stat` and `read` have no
     * timeout — against a stalled network home directory an `fs` promise never
     * settles and cannot be cancelled once libuv has it. Unbounded, one wedged
     * mount holds the user's terminal open forever over a capture the code
     * says twice is allowed to fail.
     *
     * The hang is the defect, so the assertion is that the run ends at all;
     * without the deadline this test fails by timing out, which is exactly the
     * symptom being fixed. The loss report is asserted alongside it because
     * giving up quietly would trade a visible hang for an invisible gap.
     *
     * Slow on purpose: it measures a ten second deadline, so it costs ten
     * seconds. The neighbouring tests already pay real poll intervals.
     *
     * There is a precedent for not paying it — `codex-turn-harvest.unit.test.ts`
     * fakes `setTimeout`/`clearTimeout`/`Date` selectively so real file writes
     * still run, then advances the clock. It was considered and not taken. That
     * test advances past one timeout; this one would have to fake the poll
     * interval as well, and the thing under test is precisely how the deadline
     * and an in-flight poll pass interleave. Faking both halves of the
     * interaction being asserted is how a deadline test goes green without
     * proving a deadline. Ten real seconds, once, is the cheaper mistake to
     * avoid.
     *
     * Unbound: no scenario describes a stalled session directory.
     */
    it("gives the shell its prompt back when the final sweep cannot finish", async () => {
      child.state.holdOpen = true;

      vi.mocked(globalThis.fetch).mockImplementation((async (
        _url: unknown,
        init?: { body?: string },
      ) => {
        if (init?.body) posted.push(init.body);
        // Never settles, standing in for the unbounded half of the sweep. A
        // real post could not do this - the transport caps it at five seconds
        // - but a read against a stalled mount can, and it reaches the same
        // await. The executor drops both callbacks deliberately; it is bound
        // to a name so that reads as the point rather than as an omission.
        const neverSettles = new Promise<Response>(() => undefined);
        return await neverSettles;
      }) as unknown as typeof fetch);

      const run = launchPi();
      await waitUntil(() => child.state.close !== null, "the child to be spawned");

      await writeFile(
        join(dir, "own.jsonl"),
        `${headerLine({ id: OWN_ID })}\n${assistantRow("55555555")}\n`,
        "utf8",
      );
      await waitUntil(() => posted.length === 1, "the tick's pass to start");

      // pi exits with the pass still wedged.
      child.state.close?.();

      const startedAt = Date.now();
      await run;
      const waited = Date.now() - startedAt;

      // Three times the deadline, because the claim is bounded-versus-forever
      // and nothing tighter is worth a flake: a loaded runner can add seconds
      // to a ten-second wait without the code under test being wrong. The
      // wedge never resolves, so unbounded this line is not reached late, it
      // is not reached at all - the suite timeout below is what would fail.
      expect(waited).toBeLessThan(30_000);
      // The turn the deadline interrupted is on the wire, so it is neither
      // pending nor dropped and the count-based report says nothing about it.
      // Exiting quietly here would trade a visible hang for an invisible gap,
      // which is the trade this whole capture path refuses to make.
      //
      // Matched on the sentence rather than the rendered seconds: the number
      // belongs to PI_FINAL_SWEEP_DEADLINE_MS, and tuning it is not a
      // behaviour change this test should be able to veto.
      expect(stderrText()).toContain("pi session capture did not finish in");
      expect(stderrText()).toContain("may not have been recorded");
    }, 40_000);
  });

  describe("when no ingestion endpoint or key could be resolved", () => {
    /**
     * Capture off is announced, never silent.
     *
     * pi has no second capture path. The CLI does not route pi through the
     * gateway, by decision (see wrapper-mode.ts), so there is no gateway run
     * to fall back on. A run that cannot post is therefore total data loss for
     * that session, and total data loss that prints nothing is
     * indistinguishable from working software. This is the "assert loudly"
     * half of the choice not to gate capture on the mode.
     *
     * Unbound: no scenario describes this state, which after the ingestion-only
     * policy is unreachable in production.
     */
    it("says capture is off instead of going quiet", async () => {
      vi.mocked(resolveWrapperMode).mockResolvedValueOnce({
        mode: "ingestion",
        vars: {},
        clears: [],
      } as Awaited<ReturnType<typeof resolveWrapperMode>>);

      child.state.writes = async () => {
        await writeFile(
          join(dir, "own.jsonl"),
          `${headerLine({ id: OWN_ID })}\n${assistantRow("ffffffff")}\n`,
          "utf8",
        );
      };

      await launchPi();

      expect(posted).toEqual([]);
      expect(stderrText()).toContain("pi session capture is off");
    });
  });
});

/**
 * The exit sweep reads to the end of the file, not to the end of one window.
 *
 * These two are the only tests in the suite that write a session file larger
 * than the reader's real window, and they have to: the window is
 * `pi-session-stream.ts:98`, 8 MiB, and the wrapper does not expose an override
 * for it. Everything below the wrapper is covered against an injected window in
 * `pi-capture.unit.test.ts`; what only a wrapper test can fail on is whether
 * the exit path itself keeps reading, and the exit path reads through the real
 * cap.
 *
 * The shape is a `pi --session` resume: a long conversation already on disk,
 * this run's turn appended to the end of it. One pass consumes a window of pure
 * history, whose rows the row clock in `readTurnsSince` drops as another run's
 * work, so it posts nothing at all — and the turn the user just produced is
 * past that window. A single-pass sweep exits there, and the next run's
 * `sinceMs` is later than that turn, so nothing picks it up afterwards.
 */
describe("given a resumed pi session larger than one pass can read", () => {
  /** The real cap in `pi-session-stream.ts`, which the wrapper cannot override. */
  const READER_WINDOW_BYTES = 8 * 1024 * 1024;

  /** A turn from a previous conversation: before this run, so capture drops it. */
  function historicalRow(id: string, pad: string): string {
    const then = "2026-01-02T03:04:05.000Z";
    return JSON.stringify({
      type: "message",
      id,
      parentId: null,
      timestamp: then,
      message: {
        role: "assistant",
        content: [{ type: "text", text: `old${pad}` }],
        timestamp: Date.parse(then),
        model: "openai/gpt-5-mini",
      },
    });
  }

  /**
   * `count` rows of history, comfortably past the window between them.
   *
   * Built as one string and written once: the point is a file whose first
   * window ends inside it, and how it got that size is not the subject.
   */
  function historyLines({
    count,
    startAt,
  }: {
    count: number;
    startAt: number;
  }): string {
    const pad = "h".repeat(4_000);
    const lines: string[] = [];
    for (let index = 0; index < count; index++) {
      // Ids are eight hex characters, which is what the reader keys on.
      lines.push(historicalRow((startAt + index).toString(16).padStart(8, "0"), pad));
    }
    return `${lines.join("\n")}\n`;
  }

  describe("when the run's own turn sits past the first window", () => {
    it("keeps reading until the file is consumed and posts that turn", async () => {
      child.state.writes = async () => {
        // Header, then more than a window of history, then this run's turn.
        // 2,200 rows of just over 4 KiB each is a little over 9 MiB.
        const contents =
          `${headerLine({ id: OWN_ID })}\n` +
          `${historyLines({ count: 2_200, startAt: 0x10000000 })}` +
          `${assistantRow("99999999")}\n`;
        await writeFile(join(dir, "own.jsonl"), contents, "utf8");
        expect((await stat(join(dir, "own.jsonl"))).size).toBeGreaterThan(
          READER_WINDOW_BYTES,
        );
      };

      await launchPi();

      // Exactly the one turn that belongs to this run. The history is dropped
      // by the row clock, so a count of 1 also says the drain did not start
      // re-sending somebody else's conversation.
      expect(recordsSent(), why()).toBe(1);
      // Counted as records rather than matched on the row id, because a row id
      // is not something pi's events carry — the same reason the poll tests
      // above count them.
      expect(wire(), why()).toContain(OWN_ID);
      // Nothing left behind, so the exit report stays quiet.
      expect(stderrText()).not.toContain("short of the end");
    }, 60_000);
  });

  describe("when the sweep is cut off with the file still unread", () => {
    /**
     * Giving up quietly here would rebuild the bug one door along.
     *
     * The counters the exit report already had cannot see this: a turn still
     * on disk was never read, so it was never pending and never dropped, and
     * a run that abandoned half a session file would print the same nothing
     * as a run that captured all of it.
     *
     * Arranged as a post that never settles, the same stand-in for an
     * unbounded wait the deadline test above uses. The current turn is at the
     * TOP of the file this time, so the first pass has something to post and
     * wedges on it with the rest of the file still unread — a hang on the last
     * pass would leave nothing unread and prove nothing.
     *
     * Slow on purpose: it measures the ten second deadline, so it costs ten
     * seconds. See PI_FINAL_SWEEP_DEADLINE_MS.
     *
     * Unbound: no scenario describes a sweep that runs out of time.
     */
    it("says how much of the session file it never read", async () => {
      vi.mocked(globalThis.fetch).mockImplementation((async (
        _url: unknown,
        init?: { body?: string },
      ) => {
        if (init?.body) posted.push(init.body);
        // Bound to a name so the dropped callbacks read as the point rather
        // than as an omission, exactly as in the deadline test above.
        const neverSettles = new Promise<Response>(() => undefined);
        return await neverSettles;
      }) as unknown as typeof fetch);

      child.state.writes = async () => {
        const contents =
          `${headerLine({ id: OWN_ID })}\n` +
          `${assistantRow("88888888")}\n` +
          `${historyLines({ count: 2_200, startAt: 0x20000000 })}`;
        await writeFile(join(dir, "own.jsonl"), contents, "utf8");
        expect((await stat(join(dir, "own.jsonl"))).size).toBeGreaterThan(
          READER_WINDOW_BYTES,
        );
      };

      const startedAt = Date.now();
      await launchPi();
      const waited = Date.now() - startedAt;

      // Bounded rather than forever, on the same three-times margin the
      // deadline test uses: a loaded runner can add seconds to a ten second
      // wait without the code under test being wrong.
      expect(waited).toBeLessThan(30_000);
      expect(stderrText()).toContain("pi session capture did not finish in");
      // The line the counters could not have produced. Matched on the
      // sentence rather than the byte figure, which is a property of the
      // fixture and not a behaviour this test should be able to veto.
      expect(stderrText()).toContain("short of the end of this session's file");
      expect(stderrText()).toContain("will not be recorded");
    }, 60_000);
  });
});

/**
 * The drain stops, whatever the file underneath it does.
 *
 * Driven against a stand-in capture rather than through `runWrapped`, because
 * the claim is that the loop ends and a run through the wrapper cannot fail on
 * a loop that does not: the ten second deadline would cut it off and the run
 * would read as slow rather than as wrong. The stand-in is the whole of the
 * `PiCapture` contract, so a future field cannot be quietly ignored here.
 *
 * Unbound: no scenario describes the number of passes a sweep makes.
 */
describe("draining capture at exit", () => {
  /** A capture that reports whatever backlog a test tells it to. */
  function fakeCapture(unread: () => number): {
    capture: PiCapture;
    harvests: () => number;
  } {
    let harvests = 0;
    return {
      harvests: () => harvests,
      capture: {
        harvest: async () => {
          harvests++;
          return 0;
        },
        pendingCount: () => 0,
        droppedCount: () => 0,
        unreadBytes: unread,
      },
    };
  }

  describe("given a file that is fully read on the first pass", () => {
    it("makes exactly one pass, the way the single sweep it replaced did", async () => {
      const { capture, harvests } = fakeCapture(() => 0);

      await drainPiCapture(capture);

      expect(harvests()).toBe(1);
    });
  });

  describe("given a pass that consumes nothing", () => {
    /**
     * A backlog that does not move is the shape of a file that cannot be read
     * at all — unreadable between the `stat` and the open, or a window holding
     * no complete line.
     *
     * Measured with the guard deleted: the run does not fail, it hangs, and
     * `--testTimeout=8000` does not rescue it. The loop only ever awaits
     * already-resolved promises, so it drains the microtask queue without
     * yielding to a timer, and vitest's own timeout never gets to fire. Two
     * minutes produced no test result at all and the process had to be killed.
     * So this asserts a pass count rather than a duration — a duration
     * assertion is unreachable on a run that never reports.
     */
    it("stops instead of calling harvest again forever", async () => {
      const { capture, harvests } = fakeCapture(() => 4_096);

      await drainPiCapture(capture);

      // One pass, then the pass that proves the first one moved nothing.
      expect(harvests()).toBe(2);
    });
  });

  describe("given a file pi is appending to faster than it is read", () => {
    /**
     * Stopping is the right answer, not a compromise: pi has already exited by
     * the time this runs, so a growing file is another process's session, and
     * the shell is waiting on us either way.
     */
    it("stops rather than chasing the end of the file", async () => {
      let unread = 1_000;
      const { capture, harvests } = fakeCapture(() => {
        unread += 1_000;
        return unread;
      });

      await drainPiCapture(capture);

      expect(harvests()).toBe(2);
    });
  });

  describe("given a file that takes several passes to finish", () => {
    it("keeps going until nothing is left unread", async () => {
      const remaining = [900, 600, 300, 0];
      const { capture, harvests } = fakeCapture(() => remaining.shift() ?? 0);

      await drainPiCapture(capture);

      expect(harvests()).toBe(4);
    });
  });
});
