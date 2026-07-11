import { describe, expect, it } from "vitest";
import type { TraceLogRecordDto } from "~/server/api/routers/tracesV2";
import { logEventTone, summarizeLogEvent } from "../logSummary";

function log(attributes: Record<string, string>): TraceLogRecordDto {
  return {
    spanId: "span-1",
    timeUnixMs: 1_000,
    body: "",
    attributes,
    resourceAttributes: {},
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  };
}

describe("summarizeLogEvent", () => {
  describe("given a tool the user denied", () => {
    it("names the tool and the reason", () => {
      const summary = summarizeLogEvent(
        log({
          "event.name": "tool_decision",
          decision: "reject",
          tool_name: "Bash",
          source: "user_reject",
        }),
      );
      expect(summary).toBe("Denied Bash (user_reject)");
    });
  });

  describe("given a tool the user approved", () => {
    it("names the tool", () => {
      const summary = summarizeLogEvent(
        log({ "event.name": "tool_decision", decision: "accept", tool_name: "Read" }),
      );
      expect(summary).toBe("Approved Read");
    });
  });

  describe("given a compaction with before/after counts", () => {
    it("reports the token counts", () => {
      const summary = summarizeLogEvent(
        log({ "event.name": "compaction", pre_tokens: "142000", post_tokens: "18000" }),
      );
      expect(summary).toBe("Context compacted: 142k → 18k tokens");
    });
  });

  describe("given a rate limit", () => {
    it("names it specifically, not as a generic API error", () => {
      const summary = summarizeLogEvent(
        log({ "event.name": "api_error", status_code: "429" }),
      );
      expect(summary).toBe("Rate limited by the provider");
    });
  });

  describe("given an event name we don't recognise", () => {
    it("returns null so the caller falls back to a generic view", () => {
      const summary = summarizeLogEvent(log({ "event.name": "some_future_event" }));
      expect(summary).toBeNull();
    });
  });

  describe("given a log record with no event name at all", () => {
    it("returns null", () => {
      expect(summarizeLogEvent(log({}))).toBeNull();
    });
  });
});

describe("logEventTone", () => {
  it("flags a denied tool call as danger", () => {
    expect(
      logEventTone(
        log({ "event.name": "tool_decision", decision: "reject", tool_name: "Bash" }),
      ),
    ).toBe("danger");
  });

  it("leaves an approved tool call neutral", () => {
    expect(
      logEventTone(
        log({ "event.name": "tool_decision", decision: "accept", tool_name: "Read" }),
      ),
    ).toBe("neutral");
  });

  it("flags a failed tool result as danger", () => {
    expect(
      logEventTone(
        log({ "event.name": "tool_result", tool_name: "Bash", error_type: "timeout" }),
      ),
    ).toBe("danger");
  });

  it("leaves a successful tool result neutral", () => {
    expect(
      logEventTone(log({ "event.name": "tool_result", tool_name: "Read" })),
    ).toBe("neutral");
  });

  it("flags an api_error as danger", () => {
    expect(logEventTone(log({ "event.name": "api_error" }))).toBe("danger");
  });

  it("flags a model refusal as warning", () => {
    expect(logEventTone(log({ "event.name": "api_refusal" }))).toBe("warning");
  });

  it("is neutral for an event we don't recognise", () => {
    expect(logEventTone(log({ "event.name": "some_future_event" }))).toBe(
      "neutral",
    );
  });
});
