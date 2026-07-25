import { describe, expect, it } from "vitest";
import type { TraceLogRecordDto } from "~/server/api/routers/tracesV2";
import { groupLogsBySpanId } from "../useSpanLogs";

function log(spanId: string, timeUnixMs: number): TraceLogRecordDto {
  return {
    spanId,
    timeUnixMs,
    body: "",
    attributes: {},
    resourceAttributes: {},
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  };
}

describe("groupLogsBySpanId", () => {
  describe("given logs from several spans", () => {
    it("groups each log under the span that emitted it", () => {
      const grouped = groupLogsBySpanId([
        log("span-a", 1_000),
        log("span-b", 2_000),
        log("span-a", 3_000),
      ]);

      expect(grouped.get("span-a")).toHaveLength(2);
      expect(grouped.get("span-b")).toHaveLength(1);
      expect(grouped.has("span-c")).toBe(false);
    });
  });

  describe("given a log with no span id", () => {
    it("is dropped rather than grouped under an empty key", () => {
      const grouped = groupLogsBySpanId([log("", 1_000)]);
      expect(grouped.size).toBe(0);
    });
  });
});
