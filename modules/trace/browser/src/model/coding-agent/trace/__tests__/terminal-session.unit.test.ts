import type { TranscriptEntry } from "@langwatch/coding-agent-contract";
import type { SpanDetail } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  buildEntryTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  promptLineText,
  toolPrimaryArg,
} from "../terminal-session.ts";

function rootSpan(name: string): SpanDetail {
  return {
    spanId: "run",
    parentSpanId: null,
    name,
    type: "agent",
    startTimeMs: 1,
    endTimeMs: 2,
    durationMs: 1,
    status: "ok",
    params: {},
    events: [],
  };
}

function prompt(atMs: number, text: string | null): TranscriptEntry {
  return { kind: "user_prompt", atMs, text, chars: text?.length ?? 0 };
}

const TRACE_ID = "52a4e6ca13a6add98e17294539567017";

describe("promptLineText", () => {
  describe("given a trace named after its own root span", () => {
    /** @scenario "The prompt line never shows a span name as if the user had typed it" */
    it("shows the session's first prompt instead of the span name", () => {
      expect(
        promptLineText({
          traceId: TRACE_ID,
          sessionName: "pi.harness.run",
          spans: [rootSpan("pi.harness.run")],
          entries: [prompt(1, null), prompt(2, "fix the flaky test"), prompt(3, "and lint it")],
        }),
      ).toBe("fix the flaky test");
    });

    it("shows nothing rather than the span name when no prompt carries text", () => {
      expect(
        promptLineText({
          traceId: TRACE_ID,
          sessionName: "pi.harness.run",
          spans: [rootSpan("pi.harness.run")],
          entries: [modelCall(1, 10, 0), prompt(2, "   ")],
        }),
      ).toBeNull();
    });
  });

  describe("given a logs-only trace named after its own id", () => {
    /** @scenario "The prompt line never shows a trace id as if the user had typed it" */
    it("shows the session's first prompt instead of the id", () => {
      expect(
        promptLineText({
          traceId: TRACE_ID,
          sessionName: TRACE_ID.slice(0, 8),
          spans: [],
          entries: [prompt(1, "Reply with just hi")],
        }),
      ).toBe("Reply with just hi");
    });
  });

  describe("given a trace with a name of its own", () => {
    it("keeps the name", () => {
      expect(
        promptLineText({
          traceId: TRACE_ID,
          sessionName: "Fix the flaky CI job",
          spans: [rootSpan("claude_code.interaction")],
          entries: [prompt(1, "something else")],
        }),
      ).toBe("Fix the flaky CI job");
    });

    it("keeps a name shorter than an abbreviated id that the id happens to start with", () => {
      expect(
        promptLineText({
          traceId: TRACE_ID,
          sessionName: TRACE_ID.slice(0, 3),
          spans: [],
          entries: [prompt(1, "something else")],
        }),
      ).toBe(TRACE_ID.slice(0, 3));
    });
  });
});

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
      const timeline = buildEntryTimeline({
        entries: [
          modelCall(1000, 100, 0.01),
          note(1500),
          modelCall(2000, 50, 0.02),
          modelCall(3000, 25, 0.03),
        ],
      });
      expect(timeline.map((p) => p.cumulativeTokens)).toEqual([100, 100, 150, 175]);
      expect(timeline.map((p) => p.cumulativeCostUsd)).toEqual([0.01, 0.01, 0.03, 0.06]);
    });
  });

  describe("given entries with timestamps", () => {
    it("measures elapsed time from the first entry", () => {
      const timeline = buildEntryTimeline({
        entries: [note(1000), note(3000), note(8000)],
      });
      expect(timeline.map((p) => p.elapsedMs)).toEqual([0, 2000, 7000]);
    });
  });

  describe("given the session's own start time", () => {
    it("measures elapsed time from the session start, not the loaded window", () => {
      const timeline = buildEntryTimeline({
        entries: [note(5000), note(8000)],
        startAtMs: 1000,
      });
      expect(timeline.map((p) => p.elapsedMs)).toEqual([4000, 7000]);
    });

    it("never reads negative when an entry predates the anchor by a hair", () => {
      const timeline = buildEntryTimeline({
        entries: [note(990)],
        startAtMs: 1000,
      });
      expect(timeline[0]!.elapsedMs).toBe(0);
    });

    it("falls back to the first entry when the anchor is null", () => {
      const timeline = buildEntryTimeline({
        entries: [note(1000), note(4000)],
        startAtMs: null,
      });
      expect(timeline.map((p) => p.elapsedMs)).toEqual([0, 3000]);
    });
  });

  describe("given non-model-call entries", () => {
    it("carries the running totals forward without adding to them", () => {
      const timeline = buildEntryTimeline({
        entries: [modelCall(1000, 10, 0), note(2000)],
      });
      expect(timeline[1]!.cumulativeTokens).toBe(10);
    });
  });
});

describe("toolPrimaryArg", () => {
  it("prefers file_path for a Read/Edit call", () => {
    expect(toolPrimaryArg({ file_path: "/a/b.ts", limit: 20 })).toBe("/a/b.ts");
  });

  it("prefers command for a Bash call", () => {
    expect(toolPrimaryArg({ command: "git status", timeout: 5 })).toBe("git status");
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
