/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@langwatch/coding-agent-contract";
import {
  type LoadedTurn,
  mergeSessionTurns,
  type TerminalToolSpan,
} from "@langwatch/coding-agent-web";

function prompt(text: string, atMs: number): TranscriptEntry {
  return { kind: "user_prompt", atMs, text, chars: text.length };
}

function reply(text: string, atMs: number): TranscriptEntry {
  return { kind: "assistant_message", atMs, text, model: "claude-opus-4" };
}

function span(id: string): TerminalToolSpan {
  return {
    toolName: id,
    durationMs: 10,
    isError: false,
    resultTokens: null,
    filePath: null,
    bashCommand: null,
    output: null,
    content: null,
    diff: null,
  };
}

function turn({
  traceId,
  timestamp,
  entries,
  spanIds = [],
}: {
  traceId: string;
  timestamp: number;
  entries: TranscriptEntry[];
  spanIds?: string[];
}): LoadedTurn {
  return {
    traceId,
    timestamp,
    entries,
    toolSpans: new Map(spanIds.map((id) => [id, span(id)])),
  };
}

const earlier = turn({
  traceId: "turn-1",
  timestamp: 1_000,
  entries: [prompt("check git status", 1_000), reply("On branch main.", 1_100)],
  spanIds: ["span-a"],
});

const opened = turn({
  traceId: "turn-2",
  timestamp: 2_000,
  entries: [prompt("bump the version", 2_000), reply("Bumped to 2.", 2_100)],
  spanIds: ["span-b"],
});

describe("mergeSessionTurns", () => {
  describe("given several turns of one session, oldest first", () => {
    it("lays the transcripts end to end in the order they happened", () => {
      const merged = mergeSessionTurns([earlier, opened], {
        turnCount: 5,
        firstTurnNumber: 4,
      });

      expect(
        merged.entries.map((entry) =>
          entry.kind === "user_prompt" || entry.kind === "assistant_message"
            ? entry.text
            : entry.kind,
        ),
      ).toEqual(["check git status", "On branch main.", "bump the version", "Bumped to 2."]);
    });

    it("names every row by its own turn and position, not by where it landed", () => {
      const merged = mergeSessionTurns([earlier, opened], {
        turnCount: 5,
        firstTurnNumber: 4,
      });

      expect(merged.rowKeys).toEqual(["turn-1#0", "turn-1#1", "turn-2#0", "turn-2#1"]);
    });

    it("keeps the opened turn's row names identical after a turn is prepended", () => {
      const before = mergeSessionTurns([opened], {
        turnCount: 5,
        firstTurnNumber: 5,
      });
      const after = mergeSessionTurns([earlier, opened], {
        turnCount: 5,
        firstTurnNumber: 4,
      });

      expect(after.rowKeys.slice(-before.rowKeys.length)).toEqual(before.rowKeys);
    });

    it("unions the tool spans, which are unique across the whole session", () => {
      const merged = mergeSessionTurns([earlier, opened], {
        turnCount: 5,
        firstTurnNumber: 4,
      });

      expect([...merged.toolSpans.keys()].sort()).toEqual(["span-a", "span-b"]);
    });
  });

  describe("given a boundary between two turns", () => {
    it("marks it at the newer turn's first entry, with its place in the session", () => {
      const merged = mergeSessionTurns([earlier, opened], {
        turnCount: 12,
        firstTurnNumber: 4,
      });

      expect([...merged.turnDividers.entries()]).toEqual([
        [2, { turnNumber: 5, turnCount: 12, atMs: 2_000 }],
      ]);
    });

    it("draws nothing above the oldest turn loaded, which has no other side", () => {
      const merged = mergeSessionTurns([earlier, opened], {
        turnCount: 12,
        firstTurnNumber: 4,
      });

      expect(merged.turnDividers.has(0)).toBe(false);
    });
  });

  describe("given a turn whose transcript carried nothing", () => {
    const empty = turn({
      traceId: "turn-empty",
      timestamp: 1_500,
      entries: [],
      spanIds: ["span-empty"],
    });

    it("adds no rows and no boundary for it", () => {
      const merged = mergeSessionTurns([earlier, empty, opened], {
        turnCount: 12,
        firstTurnNumber: 4,
      });

      expect(merged.rowKeys).toEqual(["turn-1#0", "turn-1#1", "turn-2#0", "turn-2#1"]);
      expect([...merged.turnDividers.keys()]).toEqual([2]);
    });

    it("still counts it as a turn, so the next boundary reads its true position", () => {
      const merged = mergeSessionTurns([earlier, empty, opened], {
        turnCount: 12,
        firstTurnNumber: 4,
      });

      expect(merged.turnDividers.get(2)?.turnNumber).toBe(6);
    });

    it("keeps the spans it did report", () => {
      const merged = mergeSessionTurns([earlier, empty, opened], {
        turnCount: 12,
        firstTurnNumber: 4,
      });

      expect(merged.toolSpans.has("span-empty")).toBe(true);
    });
  });

  describe("given only the opened turn", () => {
    it("returns it untouched, with no boundary anywhere", () => {
      const merged = mergeSessionTurns([opened], {
        turnCount: 1,
        firstTurnNumber: 1,
      });

      expect(merged.entries).toHaveLength(2);
      expect(merged.turnDividers.size).toBe(0);
    });
  });
});
