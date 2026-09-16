/**
 * What capture puts on the wire, and what it does when the post fails.
 *
 * Both tests here drive the real send path — `harvest()` through
 * `postOtlpBody` — with `fetchImpl` recording every request, because both
 * claims are about requests rather than about the body builder. A test of
 * `buildPiEventsPayload` alone would pass a build that posted spans from
 * anywhere else in capture.
 *
 * The failure test is unbound: no scenario in the feature file describes
 * delivery failure. The behaviour is still load-bearing, because the failure it
 * prevents is silent. The reader de-duplicates at READ time: a row enters its
 * seen-set before anything is sent, and it will never offer that row again. So
 * unlike the codex harvest — which marks a turn emitted only after a successful
 * post and retries the rest next tick — a pi post that fails loses those turns
 * permanently unless someone holds them. That test is the test for the someone.
 */
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPiCapture, FS_CLOCK_SKEW_GRACE_MS } from "../pi-capture";
import {
  defaultPiSessionsRoot,
  resolvePiSessionDir,
} from "../pi-session-dir";

const SESSION_ID = "44444444-4444-4444-8444-444444444444";

/** The same sanitised 132-row session the reader and builder suites measure. */
const REAL_SESSION_FIXTURE = join(
  __dirname,
  "fixtures",
  "pi-session-real-shape.jsonl",
);

/** What that session yields, counted by `pi-turn-events.unit.test.ts`. */
const REAL_SESSION_EVENTS = 127;

const LOGS_ENDPOINT = "https://app.langwatch.test/api/otel/v1/logs";

let dir: string;

/** When a row carries no time of its own. Most tests do not care which. */
const ROW_TIME_ISO = "2026-09-14T10:00:05.000Z";

function messageLine(rowId: string, timestampIso = ROW_TIME_ISO): string {
  return `${JSON.stringify({
    type: "message",
    id: rowId,
    parentId: null,
    timestamp: timestampIso,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      timestamp: Date.parse(timestampIso),
      model: "openai/gpt-5-mini",
    },
  })}\n`;
}

function sessionLines(...rowIds: string[]): string {
  return (
    `${JSON.stringify({
      type: "session",
      id: SESSION_ID,
      version: 3,
      createdAt: "2026-09-14T10:00:00.000Z",
    })}\n` +
    // Called through a lambda on purpose: `map` passes the index as the second
    // argument, which would land on `messageLine`'s timestamp parameter.
    rowIds.map((rowId) => messageLine(rowId)).join("")
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-capture-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("given a pi session whose turns cannot be delivered", () => {
  describe("when a later pass succeeds", () => {
    it("sends the turns the failed pass had already read", async () => {
      await writeFile(join(dir, "s.jsonl"), sessionLines("aaaaaaaa"), "utf8");

      const bodies: string[] = [];
      let failNext = true;
      const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: string }) => {
        if (failNext) throw new Error("network is down");
        if (init?.body) bodies.push(init.body);
        return { ok: true, status: 200 } as Response;
      }) as unknown as typeof fetch;

      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: dir,
        logsEndpoint: "https://app.langwatch.test/api/otel/v1/logs",
        token: "sk-lw-test",
        fetchImpl,
      });

      expect(await capture.harvest()).toBe(0);
      // Read, not sent. The reader has consumed them and will not re-offer.
      expect(capture.pendingCount()).toBeGreaterThan(0);

      failNext = false;
      // Nothing new on disk: everything this pass sends came out of the buffer.
      expect(await capture.harvest()).toBeGreaterThan(0);
      expect(capture.pendingCount()).toBe(0);
      expect(bodies.join("")).toContain(SESSION_ID);
    });
  });
});

describe("given an outage long enough to fill the backlog", () => {
  describe("when turns are discarded to keep the buffer bounded", () => {
    /**
     * Unbound, and deliberately: the feature file has no scenario for overflow.
     *
     * The bound exists so an unreachable endpoint cannot grow the wrapper's
     * memory for the length of an outage. But a bound that drops quietly has
     * not removed the silent loss this whole feature is written against — it
     * has hidden it behind a threshold nobody can see. So the drop has to have
     * a mouth, and this is what holds it: without the warn call and the
     * `droppedCount` tally, turns vanish between two passes with the user told
     * nothing, and the exit report undercounts by exactly the number lost.
     */
    it("says so, and counts what it threw away", async () => {
      // Two turns against one slot of headroom: the older one has to go.
      await writeFile(
        join(dir, "s.jsonl"),
        sessionLines("aaaaaaaa", "bbbbbbbb"),
        "utf8",
      );

      const said: string[] = [];
      const fetchImpl = vi.fn(async () => {
        throw new Error("network is down");
      }) as unknown as typeof fetch;

      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl,
        // One event of headroom, so the session's second event overflows it
        // rather than needing 20,000 to prove the same branch.
        maxPending: 1,
        warn: (message) => said.push(message),
      });

      expect(await capture.harvest()).toBe(0);

      // Held what it could, and admitted to the rest.
      expect(capture.pendingCount()).toBe(1);
      expect(capture.droppedCount()).toBeGreaterThan(0);
      expect(said.join("")).toContain("backlog is full");

      // The outage continues and pi keeps writing. The new turn displaces the
      // held one, so the tally grows — but the warning does not repeat itself:
      // a line every tick for the length of an outage would bury pi's own
      // output in the terminal it is sharing with us.
      const droppedOnce = capture.droppedCount();
      await appendFile(join(dir, "s.jsonl"), messageLine("cccccccc"), "utf8");

      expect(await capture.harvest()).toBe(0);
      expect(capture.droppedCount()).toBeGreaterThan(droppedOnce);
      expect(said).toHaveLength(1);
    });

    /**
     * A `warn` that throws costs the notice and nothing else.
     *
     * The same shape as the injected lineage resolver the reader guards
     * (ADR-132, "The never-throws contract, pinned at the seam"): `warn` is a
     * parameter, so "harvest resolves, always" cannot rest on the care taken
     * inside any one implementation of it. The default writes to a stderr the
     * wrapped session owns and may have closed under us.
     *
     * Two assertions, because only catching the throw is not enough. A guard
     * that swallowed the failure and skipped the tally would satisfy "does not
     * reject" and leave the exit report short by exactly the turns just
     * discarded — the undercount this module's overflow accounting exists to
     * prevent. So the count is asserted alongside the resolution.
     *
     * Unbound: no scenario describes a warn callback that throws.
     */
    it("keeps counting what it discarded when the notice cannot be printed", async () => {
      await writeFile(
        join(dir, "s.jsonl"),
        sessionLines("dddddddd", "eeeeeeee"),
        "utf8",
      );

      const fetchImpl = vi.fn(async () => {
        throw new Error("network is down");
      }) as unknown as typeof fetch;

      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl,
        maxPending: 1,
        warn: () => {
          throw new Error("stderr is closed");
        },
      });

      await expect(capture.harvest()).resolves.toBe(0);
      expect(capture.droppedCount()).toBeGreaterThan(0);
    });
  });
});

describe("given a captured pi session", () => {
  describe("when what capture sends is inspected", () => {
    /** @scenario "Capture sends events and no spans" */
    it("sends at least one event, and no spans", async () => {
      await copyFile(REAL_SESSION_FIXTURE, join(dir, "session.jsonl"));

      const sent: Array<{ url: string; body: string }> = [];
      const fetchImpl = vi.fn(
        async (url: unknown, init?: { body?: string }) => {
          sent.push({ url: String(url), body: init?.body ?? "" });
          return { ok: true, status: 200 } as Response;
        },
      ) as unknown as typeof fetch;

      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl,
      });

      expect(await capture.harvest()).toBe(REAL_SESSION_EVENTS);

      // The positive half, first and separately, because it is what stops the
      // two negatives below passing vacuously: a capture that sent nothing at
      // all would post no bodies, and "no body carries a span" is trivially
      // true of no bodies. Every loop after this one runs over a non-empty
      // list only because these three assertions held.
      expect(sent.length).toBeGreaterThan(0);
      const records = sent.flatMap(({ body }) => {
        const payload = JSON.parse(body) as {
          resourceLogs?: Array<{
            scopeLogs?: Array<{ logRecords?: Array<{ eventName: string }> }>;
          }>;
        };
        return (payload.resourceLogs ?? []).flatMap((resourceLog) =>
          (resourceLog.scopeLogs ?? []).flatMap(
            (scopeLog) => scopeLog.logRecords ?? [],
          ),
        );
      });
      expect(records).toHaveLength(REAL_SESSION_EVENTS);
      expect(
        records.every((record) => record.eventName.startsWith("pi.")),
      ).toBe(true);

      // No spans, on the two surfaces a span could arrive by. First the lane:
      // OTLP puts spans behind their own endpoint, so a second post to a
      // traces path would be spans however the body were spelled.
      for (const { url } of sent) {
        expect(url).toBe(LOGS_ENDPOINT);
      }

      // Then the body: `resourceSpans` riding along inside a logs post. The
      // raw-text checks catch a span block nested under a key this parse does
      // not name. Both matter because the server fold reads model calls and
      // tool runs from a logs-only agent's EVENTS and from every other agent's
      // SPANS — so a pi turn on both lanes is a turn counted twice, which is
      // silent rather than loud.
      for (const { body } of sent) {
        expect(JSON.parse(body) as object).not.toHaveProperty("resourceSpans");
        expect(body).not.toContain("resourceSpans");
        expect(body).not.toContain("scopeSpans");
      }
    });
  });
});

/** A fetch that would succeed, so a post that happens is recorded, not refused. */
function recordingFetch() {
  return vi.fn(async () => ({ ok: true, status: 200 }) as Response);
}

/**
 * pi holds a session in memory and writes its file only when the first
 * assistant reply arrives, so a session abandoned before that leaves nothing on
 * disk at all. Whether the sessions directory itself exists depends only on
 * whether this user has ever finished a pi session before — both are the same
 * Given, and the second is every user on their first run.
 *
 * The two halves of the Then are asserted separately below because neither
 * implies the other, in both directions:
 *
 * - A build that posts an empty payload raises no error AND still returns 0,
 *   because the count returned is the batch length and the batch is empty. So
 *   the return value cannot see it. Only the untouched `fetch` can.
 * - A build that throws never reaches any assertion, so "records nothing" would
 *   pass vacuously if the awaited call were the only thing under test.
 */
describe("given a pi session the user quit before the first assistant reply", () => {
  describe("when capture runs", () => {
    /** @scenario "A session abandoned before pi wrote anything records nothing and reports no error" */
    it("posts nothing and reports no error when pi never created the sessions directory", async () => {
      const post = recordingFetch();
      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: join(dir, "sessions-pi-never-created"),
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl: post as unknown as typeof fetch,
      });

      // The await carries "no error is raised": a rejection fails here.
      const posted = await capture.harvest();

      expect(posted).toBe(0);
      // And this carries "no session is recorded".
      expect(post).not.toHaveBeenCalled();
      expect(capture.pendingCount()).toBe(0);
    });

    /** @scenario "A session abandoned before pi wrote anything records nothing and reports no error" */
    it("posts nothing and reports no error when the sessions directory holds no session file", async () => {
      const post = recordingFetch();
      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl: post as unknown as typeof fetch,
      });

      expect(await capture.harvest()).toBe(0);
      expect(post).not.toHaveBeenCalled();
      expect(capture.pendingCount()).toBe(0);

      // The control, and the reason the assertions above mean anything. A
      // capture that is simply broken — one that never reads, or swallows
      // everything it reads — satisfies both of them for the wrong reason, and
      // "recorded nothing" and "crashed quietly" are indistinguishable from
      // outside without it. The SAME instance must still post once pi writes.
      await writeFile(join(dir, "s.jsonl"), sessionLines("bbbbbbbb"), "utf8");

      expect(await capture.harvest()).toBeGreaterThan(0);
      expect(post).toHaveBeenCalled();
    });
  });
});

/**
 * Deliberately unbound, both of them.
 *
 * The scenario above says pi wrote NO file, and in each of these pi wrote one —
 * empty in the first, header-only in the second. Binding them there would
 * assert something the spec does not say. They are kept because the path
 * through capture genuinely differs: the file passes the suffix and mtime
 * filters and is offered to the reader, rather than never being listed at all.
 */
describe("given a session file pi created but never filled with turns", () => {
  describe("when capture runs", () => {
    it("posts nothing and reports no error for a file of zero bytes", async () => {
      const post = recordingFetch();
      await writeFile(join(dir, "empty.jsonl"), "", "utf8");
      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl: post as unknown as typeof fetch,
      });

      expect(await capture.harvest()).toBe(0);
      expect(post).not.toHaveBeenCalled();
    });

    it("posts nothing and reports no error for a header with no turns after it", async () => {
      const post = recordingFetch();
      await writeFile(join(dir, "header-only.jsonl"), sessionLines(), "utf8");
      const capture = createPiCapture({
        sinceMs: 0,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl: post as unknown as typeof fetch,
      });

      expect(await capture.harvest()).toBe(0);
      expect(post).not.toHaveBeenCalled();
    });
  });
});

/**
 * A turn is sent once across runs, not once per run.
 *
 * The reader's seen-set is memory and dies with the process, so a RESUMED
 * session is offered from its first row again on the next `langwatch pi`, and
 * the file's modification time has moved, so the file-level window admits it.
 * Nothing downstream removes the repeat: the session fold runs with
 * `refoldOnOutOfOrder: false` because its accumulators commute, and commuting
 * sums ADD a re-sent turn rather than collapsing it, so cost and call count
 * inflate once per run that touches the session.
 *
 * This drives two separate captures — which is what two runs are — against one
 * growing file. A single capture's in-memory dedup cannot pass it.
 */
describe("given a session captured by an earlier run", () => {
  const T1 = "2026-09-14T10:00:01.000Z";
  const T2 = "2026-09-14T10:00:02.000Z";
  const T3 = "2026-09-14T11:00:03.000Z";
  const T4 = "2026-09-14T11:00:04.000Z";

  /** Each turn has its own second, so the entry clock identifies it. */
  function stampsSent(bodies: string[]): string[] {
    return bodies.flatMap((body) => {
      const parsed = JSON.parse(body) as {
        resourceLogs: {
          scopeLogs: { logRecords: { timeUnixNano: string }[] }[];
        }[];
      };
      return parsed.resourceLogs.flatMap((resource) =>
        resource.scopeLogs.flatMap((scope) =>
          scope.logRecords.map((record) => record.timeUnixNano),
        ),
      );
    });
  }

  /** @scenario "Resuming a session does not charge its earlier turns again" */
  it("does not send that run's turns again when the session is resumed", async () => {
    const file = join(dir, "resumed.jsonl");
    await writeFile(
      file,
      `${JSON.stringify({
        type: "session",
        id: SESSION_ID,
        version: 3,
        createdAt: "2026-09-14T10:00:00.000Z",
      })}\n${messageLine("aaaaaaaa", T1)}${messageLine("bbbbbbbb", T2)}`,
      "utf8",
    );

    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      if (init?.body) bodies.push(init.body);
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    const run1 = createPiCapture({
      sinceMs: Date.parse(T1) - 1_000,
      sessionsDir: dir,
      logsEndpoint: LOGS_ENDPOINT,
      token: "sk-lw-test",
      fetchImpl,
    });
    expect(await run1.harvest()).toBe(2);

    // The user resumes. pi appends to the same file, and a NEW process reads
    // it: no memory of the first run, and a modification time that has moved.
    await appendFile(
      file,
      `${messageLine("cccccccc", T3)}${messageLine("dddddddd", T4)}`,
      "utf8",
    );

    const run2 = createPiCapture({
      sinceMs: Date.parse(T3) - 1_000,
      sessionsDir: dir,
      logsEndpoint: LOGS_ENDPOINT,
      token: "sk-lw-test",
      fetchImpl,
    });
    expect(await run2.harvest()).toBe(2);

    // Four turns exist and four were sent. Without a row-level window the
    // second run re-sends the first two and this is six, with two stamps
    // appearing twice — the shape the fold turns into doubled cost.
    const sent = stampsSent(bodies);
    expect(sent).toHaveLength(4);
    expect(new Set(sent).size).toBe(4);
  });
});

/**
 * Both unbound on purpose: no scenario in the feature file describes the
 * filesystem clock. The behaviour is still load-bearing, because when this
 * filter is wrong the run captures nothing, exits 0, and prints nothing.
 */
describe("given a filesystem clock that runs behind the run's own", () => {
  /** Records every posted body, the way the send tests above do. */
  function recordingCapture(sinceMs: number): {
    capture: ReturnType<typeof createPiCapture>;
    bodies: string[];
  } {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      if (init?.body) bodies.push(init.body);
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    return {
      bodies,
      capture: createPiCapture({
        sinceMs,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl,
      }),
    };
  }

  describe("when pi's file claims a modification time before the run started", () => {
    /**
     * The whole session is still captured.
     *
     * Not a hypothetical. The run's start is a `Date.now()`; a file's mtime is
     * the kernel's, and on Linux mtimes advance in one-millisecond steps while
     * `Date.now()` does not, so a file written after the stamp can carry an
     * mtime up to a millisecond before it. In the shape the wrapper has — a few
     * awaited hops, then one async write — that happened in 373 of 400 Linux
     * runs and 0 of 400 on macOS. It matches the CI-only failure of
     * `pi-wrapper-capture.unit.test.ts`: nothing captured, exit 0, nothing on
     * stderr. That failure was not reproduced here, so treat this as pinning
     * the unsound comparison, not as proof the flake had no other cause.
     *
     * The skew is a property of the platform and cannot be provoked on macOS,
     * so this sets the modification time by hand instead. One millisecond of
     * backdating is exactly one of those steps; the grace covers a thousand.
     */
    it("captures a file whose mtime predates the run, and its rows", async () => {
      const startedAtMs = Date.parse("2026-09-14T10:00:04.000Z");
      const file = join(dir, "skewed.jsonl");
      await writeFile(file, sessionLines("aaaaaaaa", "bbbbbbbb"), "utf8");
      // One millisecond before the run began — one step of the granularity
      // that causes this, and a time no honest clock would report for a file
      // this run's child just wrote.
      const behind = new Date(startedAtMs - 1);
      await utimes(file, behind, behind);

      const { capture, bodies } = recordingCapture(startedAtMs);

      // The rows are stamped 10:00:05, one second INTO the run, so they are
      // this run's work by the only clock that decides that.
      expect(await capture.harvest()).toBe(2);
      expect(bodies.join("\n")).toContain(SESSION_ID);
    });

    /**
     * The grace widens which files are read. It must not widen which turns are
     * sent, or a resumed session's earlier turns are billed twice — the exact
     * loss the row window exists to stop.
     *
     * The file holds one row from before the run and one from during it, and
     * the count must come out at exactly one. A file of only-old rows would
     * not do: that asserts zero, which is also what a grace too small to admit
     * the file at all produces, so it would pass for the opposite reason. One
     * of two can only happen if the file was read AND the row window judged it.
     */
    it("sends only the rows written after the run began, from that file", async () => {
      // Between the two rows: 10:00:05 is before the run, 10:00:07 during it.
      const startedAtMs = Date.parse("2026-09-14T10:00:06.000Z");
      const duringIso = "2026-09-14T10:00:07.000Z";
      const file = join(dir, "earlier.jsonl");
      await writeFile(
        file,
        sessionLines() +
          messageLine("cccccccc") +
          messageLine("dddddddd", duringIso),
        "utf8",
      );
      // Inside the grace, so the file IS offered to the reader. Without the
      // row window that alone would put both turns on the wire. A literal
      // rather than a fraction of FS_CLOCK_SKEW_GRACE_MS: deriving it from the
      // constant would shrink this fixture in step with the constant, and the
      // test would survive the grace being narrowed to nothing.
      const behind = new Date(startedAtMs - 500);
      expect(500).toBeLessThan(FS_CLOCK_SKEW_GRACE_MS);
      await utimes(file, behind, behind);

      const { capture, bodies } = recordingCapture(startedAtMs);

      expect(await capture.harvest()).toBe(1);
      // Rows reach the wire as times, not ids, so the times are what identify
      // which of the two was sent.
      const wire = bodies.join("\n");
      expect(wire).toContain(`${Date.parse(duringIso)}000000`);
      expect(wire).not.toContain(`${Date.parse(ROW_TIME_ISO)}000000`);
    });
  });
});

describe("given a default pi install, where pi writes below the sessions root", () => {
  /**
   * The end-to-end half of the directory fix, and the half that was missing
   * while the fix itself was already in.
   *
   * `pi-session-dir.unit.test.ts` asserts the STRING `resolvePiSessionDir`
   * returns. That pins the arithmetic and nothing else: it would still pass if
   * capture never read the directory it was handed, and it would still pass if
   * the walker were changed to stop one level short again, because no test
   * there opens a file. Every other test in this suite hands capture a
   * directory with the session file sitting directly inside it, so each of them
   * passes at either depth and none of them can tell the two apart.
   *
   * So this one builds the layout pi actually builds — sessions root, one
   * encoded folder per working directory, the file inside that — and runs the
   * whole path: resolve, walk, parse, post. The negative control is the load
   * bearing half. Pointing the same capture at the parent must yield nothing,
   * which is precisely the bug as it shipped: no error, no file, no turns, and
   * every test green.
   *
   * @scenario "A default pi launch is read from the folder pi makes for this project"
   */
  it("captures the session pi wrote, which the parent directory does not hold", async () => {
    const home = join(dir, "home");
    const cwd = "/work/project";

    const resolved = await resolvePiSessionDir({
      toolArgs: [],
      env: {},
      home,
      cwd,
    });
    // Spelled out rather than resolved from the environment: this test is about
    // the depth capture reads at, so the agent root it compares against should
    // not come from the same resolver the assertion is testing.
    const root = defaultPiSessionsRoot(join(home, ".pi", "agent"));

    // The resolved directory is below the root, not the root. Asserted here as
    // well as on the string, because everything after this depends on it.
    expect(resolved).not.toBe(root);
    expect(resolved.startsWith(`${root}/`)).toBe(true);

    await mkdir(resolved, { recursive: true });
    await writeFile(
      join(resolved, "20260914T100000_session.jsonl"),
      sessionLines("aaaaaaaa", "bbbbbbbb"),
      "utf8",
    );

    const captured = recordingCaptureFor(resolved);
    expect(await captured.capture.harvest()).toBe(2);
    expect(captured.bodies.join("")).toContain(SESSION_ID);

    // The negative control: the root holds a directory, never a session file.
    // A walker that stops here reads nothing and says nothing, which is how
    // this shipped green.
    const atRoot = recordingCaptureFor(root);
    expect(await atRoot.capture.harvest()).toBe(0);
    expect(atRoot.capture.pendingCount()).toBe(0);
  });

  function recordingCaptureFor(sessionsDir: string): {
    capture: ReturnType<typeof createPiCapture>;
    bodies: string[];
  } {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      if (init?.body) bodies.push(init.body);
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    return {
      bodies,
      capture: createPiCapture({
        sinceMs: 0,
        sessionsDir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl,
      }),
    };
  }
});

/**
 * The resumed session whose last turn is past the first pass's window.
 *
 * This is the shape the exit sweep used to lose, reproduced at the size the
 * window is injected down to rather than the eight megabytes it takes in
 * production. A `pi --session` resume hands capture a file that already holds a
 * long conversation; the run's own turn is appended at the end of it. One pass
 * reads a window from the top — all of it historical, all of it dropped by the
 * row clock in `readTurnsSince` — so it posts nothing and both counters stay at
 * zero, while the turn the user just produced is still on disk.
 *
 * Unbound: no scenario describes the size of a pass. What the spec covers is
 * the turn arriving, which is what the second test asserts.
 */
describe("given a resumed session whose current turn is past the first window", () => {
  /** Old enough that the row clock rejects it, whatever `sinceMs` a test picks. */
  const HISTORY_TIME_ISO = "2026-09-14T09:00:00.000Z";
  const CURRENT_TIME_ISO = "2026-09-14T10:00:05.000Z";
  /** Between the two, so history is out of the run and the last turn is in. */
  const RUN_STARTED_MS = Date.parse("2026-09-14T09:30:00.000Z");

  /**
   * A file of historical rows with one current turn on the end, and the window
   * width to read it under.
   *
   * The width is derived from the longest line rather than picked, so every row
   * fits inside a window and the file is crossed by the cap alone. A width
   * below the longest row would instead trip the long-row fallback, which reads
   * to the end of the file in one go and would finish this session on the pass
   * that is supposed to stop short of it — a fixture that passes without
   * exercising anything.
   *
   * The production window is 8 MiB and the behaviour is the same at either
   * size, because the window is a byte count and knows nothing of which one it
   * was given.
   */
  async function writeResumedSession(
    path: string,
  ): Promise<{ maxBytesPerRead: number }> {
    const pad = "h".repeat(400);
    const history = ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"].map(
      (rowId) =>
        messageLine(rowId, HISTORY_TIME_ISO).replace('"hi"', `"hi${pad}"`),
    );
    const contents =
      `${JSON.stringify({
        type: "session",
        id: SESSION_ID,
        version: 3,
        createdAt: "2026-09-14T08:00:00.000Z",
      })}\n` +
      `${history.join("")}${messageLine("eeeeeeee", CURRENT_TIME_ISO)}`;
    await writeFile(path, contents, "utf8");
    const longestLine = Math.max(
      ...contents
        .trimEnd()
        .split("\n")
        .map((line) => line.length + 1),
    );
    return { maxBytesPerRead: longestLine + 1 };
  }

  describe("when only one pass is made", () => {
    it("posts nothing, holds nothing, drops nothing, and says bytes are unread", async () => {
      const path = join(dir, "resumed.jsonl");
      const { maxBytesPerRead } = await writeResumedSession(path);

      const bodies: string[] = [];
      const fetchImpl = vi.fn(
        async (_url: unknown, init?: { body?: string }) => {
          if (init?.body) bodies.push(init.body);
          return { ok: true, status: 200 } as Response;
        },
      ) as unknown as typeof fetch;

      const capture = createPiCapture({
        sinceMs: RUN_STARTED_MS,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl,
        maxBytesPerRead,
      });

      expect(await capture.harvest()).toBe(0);

      // Every counter a caller had before this change reads clean, which is the
      // defect: nothing here distinguishes "the session is fully captured" from
      // "the user's last turn is still on disk".
      expect(bodies).toEqual([]);
      expect(capture.pendingCount()).toBe(0);
      expect(capture.droppedCount()).toBe(0);
      // The one counter that does.
      expect(capture.unreadBytes()).toBeGreaterThan(0);
    });
  });

  describe("when passes continue while bytes remain unread", () => {
    it("posts the turn the first pass never reached", async () => {
      const path = join(dir, "resumed.jsonl");
      const { maxBytesPerRead } = await writeResumedSession(path);

      const bodies: string[] = [];
      const fetchImpl = vi.fn(
        async (_url: unknown, init?: { body?: string }) => {
          if (init?.body) bodies.push(init.body);
          return { ok: true, status: 200 } as Response;
        },
      ) as unknown as typeof fetch;

      const capture = createPiCapture({
        sinceMs: RUN_STARTED_MS,
        sessionsDir: dir,
        logsEndpoint: LOGS_ENDPOINT,
        token: "sk-lw-test",
        fetchImpl,
        maxBytesPerRead,
      });

      let posted = 0;
      let passes = 0;
      // Bounded rather than `while`, so a signal that never reaches zero fails
      // this test instead of hanging it.
      for (let pass = 0; pass < 40; pass++) {
        passes++;
        posted += await capture.harvest();
        if (capture.unreadBytes() === 0) break;
      }

      // The window has to have actually bitten, or this is one ordinary pass
      // and the loop it is here to justify was never needed.
      expect(passes).toBeGreaterThan(1);
      expect(posted).toBe(1);
      expect(capture.unreadBytes()).toBe(0);
      expect(bodies.join("")).toContain(SESSION_ID);
    });
  });
});
