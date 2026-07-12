import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import {
  buildEntryTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  toolPrimaryArg,
} from "../terminalSession";

function modelCall(atMs: number, tokens: number, costUsd: number): TranscriptEntry {
  return {
    kind: "model_call",
    atMs,
    model: null,
    tokens,
    costUsd,
    durationMs: null,
    spanId: `llm-${atMs}`,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

function note(atMs: number): TranscriptEntry {
  return { kind: "note", atMs, level: "info", event: "x", text: "x" };
}

describe("buildEntryTimeline", () => {
  describe("given model_call entries carrying tokens and cost", () => {
    it("accumulates tokens and cost as they occur in the sequence", () => {
      const timeline = buildEntryTimeline([
        modelCall(1000, 100, 0.01),
        note(1500),
        modelCall(2000, 50, 0.02),
        modelCall(3000, 25, 0.03),
      ]);
      expect(timeline.map((p) => p.cumulativeTokens)).toEqual([
        100, 100, 150, 175,
      ]);
      expect(timeline.map((p) => p.cumulativeCostUsd)).toEqual([
        0.01, 0.01, 0.03, 0.06,
      ]);
    });
  });

  describe("given entries with timestamps", () => {
    it("measures elapsed time from the first entry", () => {
      const timeline = buildEntryTimeline([note(1000), note(3000), note(8000)]);
      expect(timeline.map((p) => p.elapsedMs)).toEqual([0, 2000, 7000]);
    });
  });

  describe("given non-model-call entries", () => {
    it("carries the running totals forward without adding to them", () => {
      const timeline = buildEntryTimeline([modelCall(1000, 10, 0), note(2000)]);
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
