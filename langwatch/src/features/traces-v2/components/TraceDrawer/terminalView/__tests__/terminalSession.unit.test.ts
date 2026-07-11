import { describe, expect, it } from "vitest";
import type { ConversationTurn } from "../../transcript";
import {
  buildTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  type TerminalStep,
  toolPrimaryArg,
} from "../terminalSession";

const emptyTurn: ConversationTurn = {
  kind: "assistant",
  blocks: [],
  toolCalls: [],
  messages: [],
};

function step(partial: Partial<TerminalStep>): TerminalStep {
  return { turn: emptyTurn, ...partial };
}

describe("buildTimeline", () => {
  describe("given steps with per-step tokens and cost", () => {
    it("accumulates tokens and cost across the timeline", () => {
      const timeline = buildTimeline([
        step({ tokens: 100, costUsd: 0.01 }),
        step({ tokens: 50, costUsd: 0.02 }),
        step({ tokens: 25, costUsd: 0.03 }),
      ]);
      expect(timeline.map((p) => p.cumulativeTokens)).toEqual([100, 150, 175]);
      expect(timeline.map((p) => p.cumulativeCostUsd)).toEqual([
        0.01, 0.03, 0.06,
      ]);
    });
  });

  describe("given steps with timestamps", () => {
    it("measures elapsed time from the first timestamped step", () => {
      const timeline = buildTimeline([
        step({ timestamp: 1000 }),
        step({ timestamp: 3000 }),
        step({ timestamp: 8000 }),
      ]);
      expect(timeline.map((p) => p.elapsedMs)).toEqual([0, 2000, 7000]);
    });
  });

  describe("given steps missing metrics", () => {
    it("treats absent tokens/cost as zero", () => {
      const timeline = buildTimeline([step({}), step({ tokens: 10 })]);
      expect(timeline[0]!.cumulativeTokens).toBe(0);
      expect(timeline[1]!.cumulativeTokens).toBe(10);
    });
  });
});

describe("toolPrimaryArg", () => {
  it("prefers file_path for a Read/Edit call", () => {
    expect(toolPrimaryArg({ file_path: "/a/b.ts", limit: 20 })).toBe("/a/b.ts");
  });

  it("prefers command for a Bash call", () => {
    expect(toolPrimaryArg({ command: "git status", timeout: 5 })).toBe(
      "git status",
    );
  });

  it("falls back to the first entry when no known key is present", () => {
    expect(toolPrimaryArg({ foo: "bar" })).toBe("bar");
  });

  it("returns null for non-object input", () => {
    expect(toolPrimaryArg("nope")).toBeNull();
    expect(toolPrimaryArg(null)).toBeNull();
    expect(toolPrimaryArg([1, 2])).toBeNull();
  });
});

describe("isDiffTool", () => {
  it("recognises Edit and Write regardless of case", () => {
    expect(isDiffTool("Edit")).toBe(true);
    expect(isDiffTool("write")).toBe(true);
    expect(isDiffTool("MultiEdit")).toBe(true);
  });

  it("does not treat Bash or Read as diff tools", () => {
    expect(isDiffTool("Bash")).toBe(false);
    expect(isDiffTool("Read")).toBe(false);
  });
});

describe("extractDiffFromToolInput", () => {
  describe("given an Edit call with old_string/new_string", () => {
    it("returns the before/after pair and file path", () => {
      const result = extractDiffFromToolInput({
        file_path: "/x.ts",
        old_string: "const a = 1;",
        new_string: "const a = 2;",
      });
      expect(result).toEqual({
        oldText: "const a = 1;",
        newText: "const a = 2;",
        filePath: "/x.ts",
      });
    });
  });

  describe("given a Write call with content", () => {
    it("treats the whole file as an addition from empty", () => {
      const result = extractDiffFromToolInput({
        file_path: "/new.ts",
        content: "line1\nline2",
      });
      expect(result).toEqual({
        oldText: "",
        newText: "line1\nline2",
        filePath: "/new.ts",
      });
    });
  });

  describe("given input with no diffable shape", () => {
    it("returns null", () => {
      expect(extractDiffFromToolInput({ command: "ls" })).toBeNull();
      expect(extractDiffFromToolInput(null)).toBeNull();
    });
  });
});
