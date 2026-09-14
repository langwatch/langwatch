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
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPiCapture } from "../pi-capture";

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

function messageLine(rowId: string): string {
  return `${JSON.stringify({
    type: "message",
    id: rowId,
    parentId: null,
    timestamp: "2026-09-14T10:00:05.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      timestamp: Date.parse("2026-09-14T10:00:05.000Z"),
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
    })}\n` + rowIds.map(messageLine).join("")
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
