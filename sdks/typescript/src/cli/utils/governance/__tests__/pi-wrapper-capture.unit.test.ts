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
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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
vi.mock("../spinner", () => ({
  createSpinner: () => ({ start: () => undefined, stop: () => undefined }),
}));

// Static, not `await import`: vitest hoists every `vi.mock` above the imports,
// so the mocks are already in place, and the repo bans inline `import()`
// outside the CLI's own boot path.
import { resolveWrapperMode } from "../wrapper-mode";
import { runWrapped } from "../wrapper";

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

function assistantRow(id: string): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-14T10:00:05.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.parse("2026-09-14T10:00:05.000Z"),
      model: "openai/gpt-5-mini",
    },
  });
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

      expect(exitCalls).toEqual([0]);
      // The reader ran and its output reached the wire: not that a factory was
      // called, but that this session's own id is in a posted body.
      expect(posted.length).toBeGreaterThan(0);
      expect(wire()).toContain(OWN_ID);
    });

    /**
     * Lineage is resolved for the running session and stamped on the wire.
     *
     * `resolvePiLineage` has five bound scenarios of its own and every one of
     * them passes with the resolver wired to nothing at all, because they all
     * call it directly. This one cannot: the only lineage in it comes from
     * whatever `runWrapped` chose to hand the reader.
     *
     * @scenario "A session split off another records where it came from"
     */
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

      expect(wire()).toContain("parent_session_id");
      expect(wire()).toContain(PARENT_ID);
      expect(wire()).toContain("is_fork");
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

      // Both halves, or this passes when nothing was captured at all.
      expect(wire()).toContain(OWN_ID);
      expect(wire()).not.toContain(UNTOUCHED_ID);
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
  });

  describe("when no ingestion endpoint or key could be resolved", () => {
    /**
     * Capture off is announced, never silent.
     *
     * pi has no second capture path — it ignores base-URL environment
     * variables, so there is no gateway run to fall back on. A run that cannot
     * post is therefore total data loss for that session, and total data loss
     * that prints nothing is indistinguishable from working software. This is
     * the "assert loudly" half of the choice not to gate capture on the mode.
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
