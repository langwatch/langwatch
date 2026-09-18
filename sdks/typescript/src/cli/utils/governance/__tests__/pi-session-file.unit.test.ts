/**
 * Turning one pi session file into rows — the header, the message rows, the
 * parent links, and the three shapes a real file arrives in that a naive
 * `JSON.parse` per line gets wrong: a torn tail, a version this build predates,
 * and a cost pi never wrote.
 *
 * Feature: specs/coding-agent/pi-session-capture.feature
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  KNOWN_SESSION_VERSIONS,
  parsePiSessionFile,
  readPiSessionFile,
} from "../pi-session-file";

// `__dirname`, not `import.meta.url`: this package type-checks against a
// CommonJS target, where `import.meta` is a compile error (TS1470).
const FIXTURE = join(__dirname, "fixtures", "pi-session-real-shape.jsonl");

const HEADER = `{"type":"session","version":3,"id":"sess-1","timestamp":"2026-09-13T15:38:12.783Z","cwd":"/tmp/project"}`;

/** An assistant row, with whatever `usage` the caller wants to test. */
function assistantLine({
  id,
  parentId,
  usage,
}: {
  id: string;
  parentId: string | null;
  usage?: unknown;
}): string {
  const message: Record<string, unknown> = {
    role: "assistant",
    content: [{ type: "text", text: "hello" }],
    provider: "anthropic",
    model: "claude-opus-4-6",
    stopReason: "stop",
    timestamp: 1_760_000_000_000,
  };
  if (usage !== undefined) message.usage = usage;
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2026-09-13T15:38:20.000Z",
    message,
  });
}

/** The `usage` shape pi writes, with the cost total the caller names. */
function usageCosting(total: number): unknown {
  return {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total },
  };
}

describe("parsePiSessionFile", () => {
  describe("given a well-formed session file", () => {
    const content = [
      HEADER,
      JSON.stringify({
        type: "model_change",
        id: "row-1",
        parentId: null,
        timestamp: "2026-09-13T15:38:12.816Z",
        provider: "google",
        modelId: "gemini-3.1-pro-preview",
      }),
      JSON.stringify({
        type: "message",
        id: "row-2",
        parentId: "row-1",
        timestamp: "2026-09-13T15:38:15.000Z",
        message: { role: "user", content: "do the thing", timestamp: 1 },
      }),
      assistantLine({ id: "row-3", parentId: "row-2", usage: usageCosting(1.5) }),
      "",
    ].join("\n");

    it("reads the session identifier, the working directory and the version off the header", () => {
      const session = parsePiSessionFile(content);

      expect(session.header).toEqual({
        sessionId: "sess-1",
        version: 3,
        cwd: "/tmp/project",
        timestamp: "2026-09-13T15:38:12.783Z",
        parentSessionFile: null,
      });
    });

    it("keeps the header out of the rows", () => {
      const session = parsePiSessionFile(content);

      expect(session.rows).toHaveLength(3);
      expect(session.rows.map((row) => row.type)).toEqual([
        "model_change",
        "message",
        "message",
      ]);
    });

    it("reads role, model, provider and the message clock off a message row", () => {
      const assistant = parsePiSessionFile(content).rows[2];

      expect(assistant?.message).toMatchObject({
        role: "assistant",
        model: "claude-opus-4-6",
        provider: "anthropic",
        stopReason: "stop",
        timestampMs: 1_760_000_000_000,
      });
      expect(assistant?.timestamp).toBe("2026-09-13T15:38:20.000Z");
    });

    it("reads tokens and cost off the row's usage", () => {
      const assistant = parsePiSessionFile(content).rows[2];

      expect(assistant?.cost).toEqual({ reported: true, total: 1.5 });
      expect(assistant?.tokens).toEqual({
        input: 10,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        total: 30,
      });
    });

    it("links each row to its parent, leaving the first row unparented", () => {
      const session = parsePiSessionFile(content);

      expect(
        session.rows.map((row) => [row.id, row.parentId]),
      ).toEqual([
        ["row-1", null],
        ["row-2", "row-1"],
        ["row-3", "row-2"],
      ]);
    });

    it("reports nothing skipped and no torn tail", () => {
      const session = parsePiSessionFile(content);

      expect(session.skippedLines).toBe(0);
      expect(session.hasTornTail).toBe(false);
    });
  });

  describe("given a session that carries no message rows", () => {
    // Deliberately unbound. This asserts a real behaviour — a header-only file
    // parses cleanly — but it does not belong to the abandoned-session
    // scenario, whose Given is that pi wrote no file at all. A header-only
    // file is a file pi wrote. Binding it there would assert something the
    // scenario does not say.
    it("returns the header with no rows and raises nothing", () => {
      const session = parsePiSessionFile(`${HEADER}\n`);

      expect(session.header?.sessionId).toBe("sess-1");
      expect(session.rows).toEqual([]);
      expect(session.skippedLines).toBe(0);
    });
  });

  describe("given a file whose last line was cut off mid-write", () => {
    const complete = [
      HEADER,
      assistantLine({ id: "row-1", parentId: null, usage: usageCosting(1) }),
      assistantLine({ id: "row-2", parentId: "row-1", usage: usageCosting(2) }),
      assistantLine({ id: "row-3", parentId: "row-2", usage: usageCosting(3) }),
    ].join("\n");
    const torn = `${complete}\n{"type":"message","id":"row-4","parentId":"row-3","mes`;

    /** @scenario "A session that stopped without shutting down cleanly keeps the turns pi had written" */
    it("keeps every complete row before the tear", () => {
      const session = parsePiSessionFile(torn);

      expect(session.rows.map((row) => row.id)).toEqual([
        "row-1",
        "row-2",
        "row-3",
      ]);
    });

    it("drops the partial line and says the tail was torn, without raising", () => {
      const session = parsePiSessionFile(torn);

      expect(session.skippedLines).toBe(1);
      expect(session.hasTornTail).toBe(true);
    });

    it("does not call the tail torn when a later line parses", () => {
      const recovered = `${torn}\n${assistantLine({
        id: "row-5",
        parentId: "row-3",
        usage: usageCosting(4),
      })}`;

      const session = parsePiSessionFile(recovered);

      expect(session.hasTornTail).toBe(false);
      expect(session.skippedLines).toBe(1);
      expect(session.rows.map((row) => row.id)).toEqual([
        "row-1",
        "row-2",
        "row-3",
        "row-5",
      ]);
    });
  });

  describe("given a format version this build has never seen", () => {
    const future = [
      `{"type":"session","version":99,"id":"sess-future","cwd":"/tmp/project"}`,
      assistantLine({ id: "row-1", parentId: null, usage: usageCosting(2.5) }),
    ].join("\n");

    // No scenario in the feature file covers an unknown version. The behaviour
    // is deliberate and stated in `pi-session-file.ts`: parse it, flag it, and
    // never guess at a field — so a version that renames `cost` yields an
    // absent cost rather than a fabricated zero. Refusing to parse would mean
    // capturing nothing at all on the day pi ships a version 4.
    it("parses the file anyway rather than refusing or throwing", () => {
      const session = parsePiSessionFile(future);

      expect(session.header?.version).toBe(99);
      expect(session.rows).toHaveLength(1);
      expect(session.rows[0]?.cost).toEqual({ reported: true, total: 2.5 });
    });

    it("flags the version as one this build does not know", () => {
      expect(parsePiSessionFile(future).isVersionKnown).toBe(false);
    });

    it("flags every version this build does know", () => {
      for (const version of KNOWN_SESSION_VERSIONS) {
        const content = `{"type":"session","version":${version},"id":"s","cwd":"/tmp"}`;

        expect(parsePiSessionFile(content).isVersionKnown).toBe(true);
      }
    });

    it("treats a header with no version at all as unknown", () => {
      const session = parsePiSessionFile(`{"type":"session","id":"s"}`);

      expect(session.header?.version).toBeNull();
      expect(session.isVersionKnown).toBe(false);
    });
  });

  describe("given an assistant turn pi charged nothing for", () => {
    /** @scenario "A turn pi charged nothing for is recorded as zero" */
    it("records the cost as a real zero", () => {
      const content = [
        HEADER,
        assistantLine({ id: "row-1", parentId: null, usage: usageCosting(0) }),
      ].join("\n");

      expect(parsePiSessionFile(content).rows[0]?.cost).toEqual({
        reported: true,
        total: 0,
      });
    });
  });

  describe("given an assistant turn carrying no cost at all", () => {
    /** @scenario "A turn carrying no cost at all is left blank rather than counted as zero" */
    it("records the cost as absent, never as zero", () => {
      const noUsage = [
        HEADER,
        assistantLine({ id: "row-1", parentId: null }),
      ].join("\n");

      const cost = parsePiSessionFile(noUsage).rows[0]?.cost;

      expect(cost).toEqual({ reported: false });
      expect(cost).not.toHaveProperty("total");
    });

    it("keeps absent and zero distinguishable in the same file", () => {
      const mixed = [
        HEADER,
        assistantLine({ id: "row-1", parentId: null, usage: usageCosting(0) }),
        assistantLine({ id: "row-2", parentId: "row-1" }),
      ].join("\n");

      const [charged, uncharged] = parsePiSessionFile(mixed).rows;

      expect(charged?.cost).toEqual({ reported: true, total: 0 });
      expect(uncharged?.cost).toEqual({ reported: false });
    });

    it("treats a usage object with no cost as absent", () => {
      const content = [
        HEADER,
        assistantLine({
          id: "row-1",
          parentId: null,
          usage: { input: 5, output: 5, totalTokens: 10 },
        }),
      ].join("\n");

      const row = parsePiSessionFile(content).rows[0];

      expect(row?.cost).toEqual({ reported: false });
      // Tokens still land — an absent cost does not blank the rest of usage.
      expect(row?.tokens.total).toBe(10);
    });

    it("treats a cost object whose total pi renamed as absent", () => {
      const content = [
        HEADER,
        assistantLine({
          id: "row-1",
          parentId: null,
          usage: { totalTokens: 10, cost: { input: 0.1, grandTotal: 0.3 } },
        }),
      ].join("\n");

      expect(parsePiSessionFile(content).rows[0]?.cost).toEqual({
        reported: false,
      });
    });

    it("treats a null total as absent rather than as zero", () => {
      const content = [
        HEADER,
        assistantLine({
          id: "row-1",
          parentId: null,
          usage: { totalTokens: 10, cost: { total: null } },
        }),
      ].join("\n");

      expect(parsePiSessionFile(content).rows[0]?.cost).toEqual({
        reported: false,
      });
    });

    it("leaves tokens pi did not report null rather than zero", () => {
      const content = [
        HEADER,
        assistantLine({ id: "row-1", parentId: null, usage: { input: 7 } }),
      ].join("\n");

      expect(parsePiSessionFile(content).rows[0]?.tokens).toEqual({
        input: 7,
        output: null,
        cacheRead: null,
        cacheWrite: null,
        total: null,
      });
    });
  });

  describe("given a row that carries usage on the entry rather than the message", () => {
    it("reads the cost off the entry, the way a summarised stretch records it", () => {
      const content = [
        HEADER,
        JSON.stringify({
          type: "compaction",
          id: "row-1",
          parentId: null,
          timestamp: "2026-09-13T15:40:00.000Z",
          summary: "earlier work",
          tokensBefore: 50_000,
          usage: usageCosting(0.75),
        }),
      ].join("\n");

      const row = parsePiSessionFile(content).rows[0];

      expect(row?.type).toBe("compaction");
      expect(row?.cost).toEqual({ reported: true, total: 0.75 });
    });
  });

  describe("given a file holding lines that are not entries", () => {
    it("skips a malformed line without losing the rows around it", () => {
      const content = [
        HEADER,
        assistantLine({ id: "row-1", parentId: null, usage: usageCosting(1) }),
        "{ not json at all",
        assistantLine({ id: "row-2", parentId: "row-1", usage: usageCosting(2) }),
      ].join("\n");

      const session = parsePiSessionFile(content);

      expect(session.rows.map((row) => row.id)).toEqual(["row-1", "row-2"]);
      expect(session.skippedLines).toBe(1);
      expect(session.hasTornTail).toBe(false);
    });

    it("skips valid JSON that is not an entry", () => {
      const content = [HEADER, "[1,2,3]", "42", '{"noType":true}'].join("\n");

      const session = parsePiSessionFile(content);

      expect(session.rows).toEqual([]);
      expect(session.skippedLines).toBe(3);
    });

    it("keeps an entry kind this build does not know, with its type intact", () => {
      const content = [
        HEADER,
        JSON.stringify({
          type: "something_pi_added_later",
          id: "row-1",
          parentId: null,
        }),
      ].join("\n");

      const session = parsePiSessionFile(content);

      expect(session.rows[0]?.type).toBe("something_pi_added_later");
      expect(session.rows[0]?.message).toBeNull();
      expect(session.skippedLines).toBe(0);
    });

    it("returns no header when the file never carries one", () => {
      const content = assistantLine({ id: "row-1", parentId: null });

      const session = parsePiSessionFile(content);

      expect(session.header).toBeNull();
      expect(session.isVersionKnown).toBe(false);
      expect(session.rows).toHaveLength(1);
    });
  });

  describe("given a session split off another one", () => {
    it("reads the parent's file path off the header without resolving it", () => {
      const content = `{"type":"session","version":3,"id":"child","cwd":"/tmp/project","parentSession":"/tmp/sessions/parent.jsonl"}`;

      expect(parsePiSessionFile(content).header?.parentSessionFile).toBe(
        "/tmp/sessions/parent.jsonl",
      );
    });
  });
});

describe("readPiSessionFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-session-file-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("given pi never wrote the file", () => {
    /** @scenario "A session abandoned before pi wrote anything records nothing and reports no error" */
    it("returns nothing and raises nothing", async () => {
      await expect(
        readPiSessionFile(join(dir, "never-written.jsonl")),
      ).resolves.toBeNull();
    });
  });

  describe("given a file pi created but has not filled in", () => {
    it("returns an empty session rather than nothing", async () => {
      const path = join(dir, "empty.jsonl");
      writeFileSync(path, "");

      const session = await readPiSessionFile(path);

      expect(session).not.toBeNull();
      expect(session?.rows).toEqual([]);
      expect(session?.header).toBeNull();
    });
  });

  describe("given a real pi session on disk", () => {
    // A structural copy of a session pi actually wrote: every entry kind, every
    // parent link and every usage number preserved exactly, with the prompts,
    // the working directory and the identifiers replaced. The counts below were
    // measured on the original before it was copied.
    let path: string;

    beforeEach(() => {
      path = join(dir, "session.jsonl");
      copyFileSync(FIXTURE, path);
    });

    it("reads the header pi wrote first", async () => {
      const session = await readPiSessionFile(path);

      expect(session?.header?.version).toBe(3);
      expect(session?.isVersionKnown).toBe(true);
      expect(session?.header?.sessionId).toBeTruthy();
    });

    it("reads every entry after the header, dropping none", async () => {
      const session = await readPiSessionFile(path);

      expect(session?.rows).toHaveLength(131);
      expect(session?.skippedLines).toBe(0);
      expect(session?.hasTornTail).toBe(false);
    });

    it("finds a parent on every row but the first", async () => {
      const session = await readPiSessionFile(path);

      const parented = session?.rows.filter((row) => row.parentId !== null);
      expect(parented).toHaveLength(130);
    });

    it("finds the assistant turns among the other roles", async () => {
      const session = await readPiSessionFile(path);

      const roles = (session?.rows ?? [])
        .map((row) => row.message?.role)
        .filter((role): role is string => role !== undefined);
      const counts = roles.reduce<Record<string, number>>((acc, role) => {
        acc[role] = (acc[role] ?? 0) + 1;
        return acc;
      }, {});

      expect(counts).toEqual({ user: 15, assistant: 43, toolResult: 69 });
    });

    it("reads a cost off all 43 assistant turns, 5 of them a real zero", async () => {
      const session = await readPiSessionFile(path);

      const assistantCosts = (session?.rows ?? [])
        .filter((row) => row.message?.role === "assistant")
        .map((row) => row.cost);

      expect(assistantCosts).toHaveLength(43);
      const reported = assistantCosts.filter((cost) => cost.reported);
      expect(reported).toHaveLength(43);
      expect(reported.filter((cost) => cost.total === 0)).toHaveLength(5);
      expect(reported.filter((cost) => cost.total > 0)).toHaveLength(38);
    });

    it("sums the session's cost from the reported turns alone", async () => {
      const session = await readPiSessionFile(path);

      const total = (session?.rows ?? []).reduce(
        (sum, row) => (row.cost.reported ? sum + row.cost.total : sum),
        0,
      );

      expect(total).toBeCloseTo(3.440474, 6);
    });

    it("reports no cost for the rows pi never priced", async () => {
      const session = await readPiSessionFile(path);

      const unreported = (session?.rows ?? []).filter(
        (row) => !row.cost.reported,
      );

      // Everything that is not an assistant turn: pi prices no user prompt and
      // no tool result in this session, and none of them becomes a zero.
      expect(unreported).toHaveLength(88);
    });
  });
});
