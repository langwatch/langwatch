/**
 * Tailing a pi session file across passes, and recording each turn once.
 *
 * Every test drives the reader against a file on disk in a throwaway
 * directory, appending to it and rewriting it between passes the way pi does,
 * because the behaviour under test is entirely about what the bytes on disk did
 * between one call and the next.
 *
 * The last test in the tailing block is the real one: a sanitised copy of a
 * 132-row pi session, fed in through three arbitrary byte offsets rather than
 * line boundaries, asserted to produce exactly what one read of the whole file
 * produces. Everything else is synthetic, because the shapes they need —
 * a half-written last line, a file rewritten smaller, two sessions sharing row
 * identifiers — are states a healthy captured session never reaches.
 *
 * Feature: specs/coding-agent/pi-session-capture.feature
 */
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePiSessionFile } from "../pi-session-file";
import { createPiSessionStream } from "../pi-session-stream";
import { buildPiTurnEvents, PI_EVENT } from "../pi-turn-events";

const SESSION_A = "00000000-0000-4000-8000-00000000000a";
const SESSION_B = "00000000-0000-4000-8000-00000000000b";

const REAL_SESSION_FILE = join(
  __dirname,
  "fixtures",
  "pi-session-real-shape.jsonl",
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lw-pi-session-stream-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const header = (id: string) => ({
  type: "session",
  version: 3,
  id,
  timestamp: "2026-09-13T15:38:12.783Z",
  cwd: "/tmp/project",
});

/** A user turn. `pad` exists only to make a file a chosen size. */
const userRow = ({
  id,
  at,
  pad = "",
}: {
  id: string;
  at: string;
  pad?: string;
}) => ({
  type: "message",
  id,
  parentId: null,
  timestamp: at,
  message: {
    role: "user",
    content: [{ type: "text", text: `ask${pad}` }],
    timestamp: Date.parse(at),
  },
});

const assistantRow = ({
  id,
  at,
  pad = "",
}: {
  id: string;
  at: string;
  pad?: string;
}) => ({
  type: "message",
  id,
  parentId: null,
  timestamp: at,
  message: {
    role: "assistant",
    content: [{ type: "text", text: `reply${pad}` }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-opus-5",
    stopReason: "stop",
    timestamp: Date.parse(at),
    usage: { input: 10, output: 20, cost: { total: 0.5 } },
  },
});

/** pi's own on-disk shape: one JSON object per line, every line terminated. */
const jsonl = (entries: readonly unknown[]) =>
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

const write = (name: string, contents: string) => {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
};

const names = (events: readonly { attributes: Record<string, unknown> }[]) =>
  events.map((event) => event.attributes["event.name"]);

const sessionIds = (
  events: readonly { attributes: Record<string, unknown> }[],
) => events.map((event) => event.attributes["session.id"]);

describe("tailing a pi session file across passes", () => {
  describe("given a file that gained turns between two passes", () => {
    /** @scenario "Turns appended after a read are picked up by the next one" */
    it("records the appended turns on the next pass and the earlier ones once", async () => {
      const path = write(
        "session.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z" }),
          userRow({ id: "aaaa0003", at: "2026-09-13T15:38:15.000Z" }),
        ]),
      );
      const stream = createPiSessionStream();

      const first = await stream.read(path);

      appendFileSync(
        path,
        jsonl([
          assistantRow({ id: "aaaa0004", at: "2026-09-13T15:38:16.000Z" }),
          userRow({ id: "aaaa0005", at: "2026-09-13T15:38:17.000Z" }),
        ]),
      );
      const second = await stream.read(path);

      expect(names(first)).toEqual([
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
        PI_EVENT.USER_PROMPT,
      ]);
      expect(names(second)).toEqual([
        PI_EVENT.API_REQUEST,
        PI_EVENT.USER_PROMPT,
      ]);
      expect([...first, ...second]).toHaveLength(5);
    });
  });

  describe("given a session that stopped without shutting down cleanly", () => {
    /**
     * Three whole turns and then half of a fourth line: the shape a SIGKILL
     * mid-append leaves behind. The bytes before the tear are intact, so a
     * reader that waits for a whole file rather than a whole line records
     * nothing at all — which is the implementation this asserts against.
     *
     * `pi-session-file.unit.test.ts` binds the same scenario one layer down, on
     * the parser. This one is the capture path: the parser is never handed the
     * torn line unless the reader decided to hand it the bytes before it.
     */
    /** @scenario "A session that stopped without shutting down cleanly keeps the turns pi had written" */
    it("records the turns pi had finished writing and drops the half-written one", async () => {
      const tornLine = JSON.stringify(
        assistantRow({ id: "aaaa0004", at: "2026-09-13T15:38:16.000Z" }),
      ).slice(0, 60);
      const path = write(
        "session.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z" }),
          userRow({ id: "aaaa0003", at: "2026-09-13T15:38:15.000Z" }),
        ]) + tornLine,
      );

      const events = await createPiSessionStream().read(path);

      expect(names(events)).toEqual([
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
        PI_EVENT.USER_PROMPT,
      ]);
    });

    /**
     * Unbound on purpose: no scenario names it. It is what stops the reader
     * consuming the bytes under a torn line — an offset that walked past them
     * would read the completed row's second half as a line of its own, and the
     * row would be lost with nothing raised.
     */
    it("emits the torn line's row once pi's next run completes it", async () => {
      const wholeLine = JSON.stringify(
        assistantRow({ id: "aaaa0004", at: "2026-09-13T15:38:16.000Z" }),
      );
      const path = write(
        "session.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" }),
        ]) + wholeLine.slice(0, 60),
      );
      const stream = createPiSessionStream();

      const torn = await stream.read(path);
      appendFileSync(path, `${wholeLine.slice(60)}\n`);
      const completed = await stream.read(path);

      expect(names(torn)).toEqual([PI_EVENT.USER_PROMPT]);
      expect(names(completed)).toEqual([PI_EVENT.API_REQUEST]);
    });
  });

  describe("given a file that shrank between passes", () => {
    /**
     * Unbound on purpose: no scenario names it. A shrink means pi replaced the
     * file — the once-per-file migration an older session gets on load — so the
     * offset we hold points past the end of a file that is still valid. Only
     * the turn appended after the rewrite is new; the rewritten rows keep their
     * identifiers and must not be sent twice.
     */
    it("re-reads from the start without repeating a turn, and still sees the next append", async () => {
      const rows = [
        userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" }),
        assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z" }),
        userRow({ id: "aaaa0003", at: "2026-09-13T15:38:15.000Z" }),
      ];
      const padded = [
        userRow({
          id: "aaaa0001",
          at: "2026-09-13T15:38:13.000Z",
          pad: "p".repeat(120),
        }),
        assistantRow({
          id: "aaaa0002",
          at: "2026-09-13T15:38:14.000Z",
          pad: "p".repeat(120),
        }),
        userRow({
          id: "aaaa0003",
          at: "2026-09-13T15:38:15.000Z",
          pad: "p".repeat(120),
        }),
      ];
      const path = write("session.jsonl", jsonl([header(SESSION_A), ...padded]));
      const stream = createPiSessionStream();

      const before = await stream.read(path);
      const sizeBefore = statSync(path).size;

      // The migration: same session, same row identifiers, fewer bytes.
      writeFileSync(path, jsonl([header(SESSION_A), ...rows]));
      const sizeAfterRewrite = statSync(path).size;
      const afterRewrite = await stream.read(path);

      appendFileSync(
        path,
        jsonl([
          assistantRow({
            id: "aaaa0004",
            at: "2026-09-13T15:38:16.000Z",
            pad: "q".repeat(200),
          }),
        ]),
      );
      const sizeAfterAppend = statSync(path).size;
      const afterAppend = await stream.read(path);

      // The setup itself has to hold, or the test proves nothing: the file must
      // really shrink, and the append must carry it back past the offset the
      // first pass left behind.
      expect(sizeAfterRewrite).toBeLessThan(sizeBefore);
      expect(sizeAfterAppend).toBeGreaterThan(sizeBefore);

      expect(names(before)).toHaveLength(3);
      expect(afterRewrite).toEqual([]);
      expect(names(afterAppend)).toEqual([PI_EVENT.API_REQUEST]);
    });
  });

  describe("given a file pi has written a header into and no rows yet", () => {
    /**
     * Unbound on purpose: no scenario names it. The header is not an entry and
     * carries no row identifier — ADR-132 §8 requires it be kept out of the
     * de-duplication set rather than keyed on its session id. It is kept out
     * structurally: rung 8's parser hands it back separately from `rows`.
     */
    it("emits nothing for the header, and emits the first row when it arrives", async () => {
      const path = write("session.jsonl", jsonl([header(SESSION_A)]));
      const stream = createPiSessionStream();

      const headerOnly = await stream.read(path);
      appendFileSync(
        path,
        jsonl([userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" })]),
      );
      const withRow = await stream.read(path);

      expect(headerOnly).toEqual([]);
      expect(names(withRow)).toEqual([PI_EVENT.USER_PROMPT]);
    });

    /**
     * Unbound, and synthetic to the point of being impossible in pi — row
     * identifiers are eight hex characters and a session id is a UUID. It is
     * here because it is the one case that tells the two implementations of
     * ADR-132 §8's header rule apart: keying the header on its session id, as
     * the ADR warns against, swallows a row that happens to carry that id.
     */
    it("does not swallow a row whose identifier equals the session id", async () => {
      const path = write(
        "session.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: SESSION_A, at: "2026-09-13T15:38:13.000Z" }),
        ]),
      );

      const events = await createPiSessionStream().read(path);

      expect(names(events)).toEqual([PI_EVENT.USER_PROMPT]);
    });
  });

  describe("given a file that is not there", () => {
    it("emits nothing and raises nothing", async () => {
      await expect(
        createPiSessionStream().read(join(dir, "never-written.jsonl")),
      ).resolves.toEqual([]);
    });
  });

  describe("given the whole of a real session, arriving in three parts", () => {
    /**
     * The split points are arbitrary byte offsets, not line boundaries, so two
     * of the three passes begin and end in the middle of a row. Asserting the
     * result is identical to one read of the finished file covers every way
     * tailing can go wrong at once: a lost row, a repeated row, a row emitted
     * from half its bytes, or an order the file does not have.
     */
    /** @scenario "Turns appended after a read are picked up by the next one" */
    it("records exactly what one read of the finished file records", async () => {
      const whole = readFileSync(REAL_SESSION_FILE, "utf8");
      const cuts = [
        Math.floor(whole.length * 0.31),
        Math.floor(whole.length * 0.67),
        whole.length,
      ];
      const path = join(dir, "real.jsonl");
      const stream = createPiSessionStream();

      const tailed = [];
      let written = 0;
      for (const cut of cuts) {
        appendFileSync(path, whole.slice(written, cut));
        written = cut;
        tailed.push(...(await stream.read(path)));
      }

      const inOneGo = buildPiTurnEvents({
        session: parsePiSessionFile(whole),
      });

      // The cuts must actually tear rows, or this is three reads of three whole
      // files and the hard part was never exercised.
      expect(whole[cuts[0] ?? 0]).not.toBe("\n");
      expect(whole[cuts[1] ?? 0]).not.toBe("\n");
      expect(inOneGo.length).toBeGreaterThan(100);
      expect(tailed).toEqual(inOneGo);
    });
  });

  describe("given a file larger than one pass is allowed to read", () => {
    /**
     * Both tests here are deliberately unbound: the spec has no scenario for
     * the size of a read, because the size of a read is not something a user
     * can observe. What they can observe is a session arriving whole, which is
     * what both assert.
     *
     * The cap is injected rather than reached, so these cost bytes instead of
     * megabytes. The behaviour is the same at either size — the window is a
     * byte count and knows nothing of which one it was given.
     */
    it("records the session whole across the passes the window forces", async () => {
      // Padded so a handful of rows comfortably exceeds the window below, and
      // so no single row does — that is the other test.
      const pad = "x".repeat(120);
      const whole = jsonl([
        header(SESSION_A),
        userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad }),
        assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad }),
        userRow({ id: "aaaa0003", at: "2026-09-13T15:38:15.000Z", pad }),
        assistantRow({ id: "aaaa0004", at: "2026-09-13T15:38:16.000Z", pad }),
        userRow({ id: "aaaa0005", at: "2026-09-13T15:38:17.000Z", pad }),
      ]);
      const path = write("big.jsonl", whole);
      // Derived from the longest row rather than picked, so every row fits a
      // window and this test turns on the cap alone. The long-row fallback is
      // the next test's subject; if the two shared a fixture, breaking either
      // would redden both and neither would name its own defect.
      const longestLine = Math.max(
        ...whole.trimEnd().split("\n").map((line) => line.length + 1),
      );
      const maxBytesPerRead = longestLine + 1;
      const stream = createPiSessionStream({ maxBytesPerRead });

      const first = await stream.read(path);
      const rest = [];
      // Bounded rather than `while`: a window that stops advancing must fail
      // this test, not hang it.
      for (let pass = 0; pass < 20; pass++) {
        rest.push(...(await stream.read(path)));
      }

      const inOneGo = buildPiTurnEvents({ session: parsePiSessionFile(whole) });

      // The window must actually have bitten, or this is one ordinary read and
      // the cap was never exercised.
      expect(whole.length).toBeGreaterThan(maxBytesPerRead);
      expect(first.length).toBeLessThan(inOneGo.length);
      expect([...first, ...rest]).toEqual(inOneGo);
    });

    it("records a row longer than the window rather than stalling on it", async () => {
      // One row that cannot fit a window, so the window holding it contains no
      // newline at all. Without the fallback the reader consumes nothing from
      // it and every later pass reads the same bytes: the session stops here,
      // silently, for the life of the process.
      const whole = jsonl([
        header(SESSION_A),
        userRow({
          id: "aaaa0001",
          at: "2026-09-13T15:38:13.000Z",
          pad: "x".repeat(2_000),
        }),
        assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z" }),
      ]);
      const path = write("long-row.jsonl", whole);
      const stream = createPiSessionStream({ maxBytesPerRead: 400 });

      const events = [];
      for (let pass = 0; pass < 20; pass++) {
        events.push(...(await stream.read(path)));
      }

      expect(names(events)).toEqual([
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
      ]);
    });
  });
});

describe("de-duplicating pi's rows", () => {
  describe("given a file nothing has appended to", () => {
    /** @scenario "The same turn is not recorded twice" */
    it("records each turn on the first pass and nothing on the second", async () => {
      const path = write(
        "session.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z" }),
        ]),
      );
      const stream = createPiSessionStream();

      const first = await stream.read(path);
      const second = await stream.read(path);

      expect(names(first)).toEqual([
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
      ]);
      expect(second).toEqual([]);
    });
  });

  describe("given one session the reader is offered under two paths", () => {
    /**
     * The pass above returns early on an unchanged size and so never reaches
     * the seen-set; this one is the route that does. A second path to the same
     * session — pi's directory resolved two ways across passes, or a session
     * copied while a run is in flight — gets its own cursor, starts at zero and
     * offers every row again. Nothing but the seen-set stops those turns being
     * recorded a second time.
     */
    /** @scenario "The same turn is not recorded twice" */
    it("records the turns under the first path and nothing under the second", async () => {
      const rows = [
        header(SESSION_A),
        userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" }),
        assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z" }),
      ];
      const first = write("session.jsonl", jsonl(rows));
      const second = write("also-session.jsonl", jsonl(rows));
      const stream = createPiSessionStream();

      const viaFirst = await stream.read(first);
      const viaSecond = await stream.read(second);

      expect(names(viaFirst)).toEqual([
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
      ]);
      expect(viaSecond).toEqual([]);
    });
  });

  describe("given two sessions whose rows carry the same identifiers", () => {
    /**
     * What a fork leaves on disk: `createBranchedSession` copies the parent's
     * row identifiers into the child verbatim, so the two files below share
     * every identifier and differ only in the session id on their header line.
     */
    /** @scenario "Two sessions sharing row identifiers are kept apart" */
    it("keeps each session's full set of turns", async () => {
      const rows = [
        userRow({ id: "cecadf21", at: "2026-09-13T15:38:13.000Z" }),
        assistantRow({ id: "a2703ef1", at: "2026-09-13T15:38:14.000Z" }),
        userRow({ id: "6e455960", at: "2026-09-13T15:38:15.000Z" }),
      ];
      const parent = write("parent.jsonl", jsonl([header(SESSION_A), ...rows]));
      const child = write("child.jsonl", jsonl([header(SESSION_B), ...rows]));
      const stream = createPiSessionStream();

      const fromParent = await stream.read(parent);
      const fromChild = await stream.read(child);

      expect(names(fromParent)).toEqual([
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
        PI_EVENT.USER_PROMPT,
      ]);
      expect(names(fromChild)).toEqual(names(fromParent));
      expect(new Set(sessionIds(fromParent))).toEqual(new Set([SESSION_A]));
      expect(new Set(sessionIds(fromChild))).toEqual(new Set([SESSION_B]));
    });
  });
});

/**
 * Neither test below is bound: the spec has no scenario for a resolver that
 * throws, and inventing a title to bind them to would be the failure this
 * ladder keeps finding. They pin a contract the module states about itself —
 * `read` reports no error — at the one seam where an outside implementation can
 * break it.
 *
 * The point of testing it here rather than in `pi-session-lineage.ts` is that
 * the resolver is a parameter. `resolvePiLineage` reports every failure as a
 * blank parent and never throws, so a test over there would prove today's
 * implementation careful and prove nothing about the next one, or about a
 * resolver written by someone who never read that module's note.
 */
describe("given a lineage resolver that throws", () => {
  const throwingResolver = async () => {
    throw new Error("parent file exploded");
  };

  it("still records the session's turns and reports no error", async () => {
    const path = write(
      "session.jsonl",
      jsonl([
        header(SESSION_A),
        userRow({ id: "cecadf21", at: "2026-09-13T15:38:13.000Z" }),
        assistantRow({ id: "a2703ef1", at: "2026-09-13T15:38:14.000Z" }),
      ]),
    );
    const stream = createPiSessionStream({ resolveLineage: throwingResolver });

    const events = await stream.read(path);

    // The transcript, whole. Asserting the rows rather than the absence of a
    // rejection: a `read` that caught the throw and returned nothing would
    // satisfy "does not throw" and still lose the session.
    expect(names(events)).toEqual([PI_EVENT.USER_PROMPT, PI_EVENT.API_REQUEST]);
    expect(new Set(sessionIds(events))).toEqual(new Set([SESSION_A]));
    // And no lineage guessed at from a lookup that failed. `parent_session_id`
    // is once-set downstream and can never be corrected, so a value invented
    // here would be permanent.
    for (const event of events) {
      expect(event.attributes).not.toHaveProperty("parent_session_id");
      expect(event.attributes).not.toHaveProperty("is_fork");
    }
  });

  it("does not call the resolver again on later passes", async () => {
    const path = write(
      "session.jsonl",
      jsonl([
        header(SESSION_A),
        userRow({ id: "cecadf21", at: "2026-09-13T15:38:13.000Z" }),
      ]),
    );
    let calls = 0;
    const stream = createPiSessionStream({
      resolveLineage: async () => {
        calls += 1;
        return await throwingResolver();
      },
    });

    await stream.read(path);
    appendFileSync(
      path,
      jsonl([assistantRow({ id: "a2703ef1", at: "2026-09-13T15:38:14.000Z" })]),
    );
    const second = await stream.read(path);

    // A failure remembered as "not yet resolved" would reopen the parent on
    // every poll tick for the life of the session — the per-tick I/O the
    // cache exists to prevent, spent on a resolver already known to be broken.
    expect(calls).toBe(1);
    expect(names(second)).toEqual([PI_EVENT.API_REQUEST]);
  });
});

/**
 * What the reader says is still on disk after a pass.
 *
 * The reason this is a question at all: one pass consumes one bounded window
 * per file, so "the pass is over" and "the file is finished" are different
 * facts, and the caller that has to stop somewhere — the wrapper's exit drain —
 * can only tell them apart if the reader says which. The trap the whole block
 * exists for is the first test: a window can land entirely on rows the reader
 * has already recorded, emit nothing at all, and still be nowhere near the end
 * of the file. A caller that read "no events" as "finished" would stop there
 * and lose everything past the window.
 *
 * Unbound: the spec has no scenario for this, because it describes how much of
 * a file a pass got through, which is not something a user can observe. What
 * they observe is the last turns of a session arriving, which the wrapper suite
 * asserts.
 */
describe("reporting what a pass left unread", () => {
  describe("given a file consumed to its end", () => {
    /**
     * Both halves in one test on purpose. "Reports zero when finished" passes
     * against a reader that reports zero always, which is the one wrong
     * implementation this whole block has to exclude, so the pass that is NOT
     * finished is asserted first and the zero only means something after it.
     */
    it("reports nothing unread, having reported the remainder before that", async () => {
      const path = write(
        "done.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad: "p".repeat(300) }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad: "p".repeat(300) }),
        ]),
      );
      const stream = createPiSessionStream({ maxBytesPerRead: 400 });

      await stream.read(path);
      expect(stream.unreadBytes()).toBeGreaterThan(0);

      for (let pass = 0; pass < 20; pass++) await stream.read(path);

      expect(stream.unreadBytes()).toBe(0);
    });
  });

  describe("given a window that falls entirely on rows already recorded", () => {
    /**
     * The whole reason the signal is bytes and not an event count.
     *
     * Two paths to one session is the cheapest way to manufacture the shape a
     * resumed session has in production: a cursor at zero, in front of rows the
     * stream has already seen. The pass reads a window of them, recognises
     * every one, and returns an empty array — a return value indistinguishable
     * from a file with nothing new in it, while the turn the user actually
     * cares about sits past the window, unread.
     */
    it("reports bytes still unread even though the pass emitted no events", async () => {
      const historical = [
        header(SESSION_A),
        userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad: "y".repeat(200) }),
        assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad: "y".repeat(200) }),
        userRow({ id: "aaaa0003", at: "2026-09-13T15:38:15.000Z", pad: "y".repeat(200) }),
      ];
      const seenPath = write("seen.jsonl", jsonl(historical));
      const resumedPath = write(
        "resumed.jsonl",
        jsonl([
          ...historical,
          assistantRow({ id: "aaaa0009", at: "2026-09-13T15:39:00.000Z" }),
        ]),
      );
      const stream = createPiSessionStream({ maxBytesPerRead: 300 });

      // Every historical row into the seen-set, under its own path and its own
      // cursor, so the file below starts from zero with nothing new in front.
      for (let pass = 0; pass < 20; pass++) await stream.read(seenPath);
      expect(stream.unreadBytes()).toBe(0);

      const firstPass = await stream.read(resumedPath);

      expect(firstPass).toEqual([]);
      // The trap: an empty pass that is not a finished file.
      expect(stream.unreadBytes()).toBeGreaterThan(0);
    });

    it("delivers the tail turn on the later passes the window forces", async () => {
      const historical = [
        header(SESSION_A),
        userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad: "y".repeat(200) }),
        assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad: "y".repeat(200) }),
        userRow({ id: "aaaa0003", at: "2026-09-13T15:38:15.000Z", pad: "y".repeat(200) }),
      ];
      const seenPath = write("seen.jsonl", jsonl(historical));
      const resumedPath = write(
        "resumed.jsonl",
        jsonl([
          ...historical,
          assistantRow({ id: "aaaa0009", at: "2026-09-13T15:39:00.000Z" }),
        ]),
      );
      const stream = createPiSessionStream({ maxBytesPerRead: 300 });
      for (let pass = 0; pass < 20; pass++) await stream.read(seenPath);

      // Driven the way the wrapper's drain drives it: one pass unconditionally,
      // then more for as long as the reader says bytes remain — rather than for
      // as long as it is handing back events, which is the signal that stops
      // one pass in and loses the turn below.
      const events = [];
      // Bounded rather than `while`, so a signal that never reaches zero fails
      // this test instead of hanging it.
      for (let pass = 0; pass < 40; pass++) {
        events.push(...(await stream.read(resumedPath)));
        if (stream.unreadBytes() === 0) break;
      }

      expect(names(events)).toEqual([PI_EVENT.API_REQUEST]);
      expect(stream.unreadBytes()).toBe(0);
    });
  });

  describe("given a file that grew after the pass that read it", () => {
    /**
     * The number is what the last pass measured, not a live reading of the
     * file. That is deliberate — a live reading would cost a `stat` per call,
     * on a signal the wrapper's drain asks for after every pass — and it is
     * safe because the only caller reads it between passes of its own.
     */
    it("reports what the last pass measured until another pass looks", async () => {
      const path = write(
        "growing.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad: "g".repeat(300) }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad: "g".repeat(300) }),
        ]),
      );
      const stream = createPiSessionStream({ maxBytesPerRead: 400 });
      await stream.read(path);
      const measured = stream.unreadBytes();
      expect(measured).toBeGreaterThan(0);

      appendFileSync(
        path,
        jsonl([userRow({ id: "aaaa0003", at: "2026-09-13T15:38:15.000Z" })]),
      );

      expect(stream.unreadBytes()).toBe(measured);
      await stream.read(path);
      expect(stream.unreadBytes()).not.toBe(measured);
    });
  });

  describe("given a file pi replaced with a smaller one", () => {
    /**
     * The branch that rewinds the cursor to zero. Measured against the same
     * migration the module note describes: the file is rewritten in place,
     * smaller, keeping its rows. Without the rewind the subtraction would be
     * against an offset past the end of the file, which is the one arrangement
     * that could make it negative.
     */
    it("reports what is unread from the top of the replacement, never a negative", async () => {
      const path = write(
        "rewritten.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad: "z".repeat(400) }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad: "z".repeat(400) }),
        ]),
      );
      const stream = createPiSessionStream({ maxBytesPerRead: 200 });
      await stream.read(path);
      expect(stream.unreadBytes()).toBeGreaterThan(0);

      const smaller = jsonl([
        header(SESSION_A),
        userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z" }),
      ]);
      writeFileSync(path, smaller);

      await stream.read(path);

      expect(stream.unreadBytes()).toBeGreaterThanOrEqual(0);
      expect(stream.unreadBytes()).toBeLessThan(smaller.length);
    });
  });

  describe("given a row longer than one window", () => {
    /**
     * The fallback at the long-row branch reads past the cap, to the end of the
     * file, rather than stalling. So the bytes it consumed are not the window's
     * width, and a number derived from the cap instead of from the cursor would
     * be wrong here by the length of the oversized row.
     */
    it("reports nothing unread once the oversized row has been consumed", async () => {
      const path = write(
        "long-row.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({
            id: "aaaa0001",
            at: "2026-09-13T15:38:13.000Z",
            pad: "x".repeat(2_000),
          }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z" }),
        ]),
      );
      const stream = createPiSessionStream({ maxBytesPerRead: 400 });

      // The first pass gets as far as the header's newline and no further: the
      // oversized row starts here, so this is the state the fallback resolves
      // from and it has to read as unfinished.
      await stream.read(path);
      expect(stream.unreadBytes()).toBeGreaterThan(400);

      for (let pass = 0; pass < 20; pass++) await stream.read(path);

      expect(statSync(path).size).toBeGreaterThan(400);
      expect(stream.unreadBytes()).toBe(0);
    });
  });

  describe("given a file that is gone by the next pass", () => {
    /**
     * A file we cannot stat has no bytes anyone can still retrieve, so the
     * backlog it was carrying is retired rather than left standing. Left
     * standing it would make the wrapper's drain loop call a pass that cannot
     * shrink it, and make the exit report claim unread turns in a session file
     * that no longer exists.
     */
    it("stops claiming its bytes are unread", async () => {
      const path = write(
        "vanishing.jsonl",
        jsonl([
          header(SESSION_A),
          userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad: "q".repeat(400) }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad: "q".repeat(400) }),
        ]),
      );
      const stream = createPiSessionStream({ maxBytesPerRead: 200 });
      await stream.read(path);
      expect(stream.unreadBytes()).toBeGreaterThan(0);

      rmSync(path);

      expect(await stream.read(path)).toEqual([]);
      expect(stream.unreadBytes()).toBe(0);
    });
  });

  describe("given several files at different points", () => {
    it("reports the sum across them", async () => {
      const rows = (id: string) => [
        header(id),
        userRow({ id: "aaaa0001", at: "2026-09-13T15:38:13.000Z", pad: "w".repeat(400) }),
        assistantRow({ id: "aaaa0002", at: "2026-09-13T15:38:14.000Z", pad: "w".repeat(400) }),
      ];
      const first = write("one.jsonl", jsonl(rows(SESSION_A)));
      const second = write("two.jsonl", jsonl(rows(SESSION_B)));
      const stream = createPiSessionStream({ maxBytesPerRead: 200 });

      await stream.read(first);
      const afterFirst = stream.unreadBytes();
      await stream.read(second);

      expect(afterFirst).toBeGreaterThan(0);
      // Strictly greater, not merely non-zero: a reader that returned one
      // file's figure instead of the total would pass a non-zero assertion.
      expect(stream.unreadBytes()).toBeGreaterThan(afterFirst);
    });
  });
});
