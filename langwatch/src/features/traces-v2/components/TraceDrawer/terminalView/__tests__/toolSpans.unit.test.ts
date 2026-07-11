import { describe, expect, it } from "vitest";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import { indexToolSpansByUseId, parsePatchHunks } from "../toolSpans";

/**
 * Claude Code's real tool spans, and the `tool.output` span event they carry
 * under `OTEL_LOG_TOOL_CONTENT=1`. Attribute names verified against the CLI
 * bundle: Bash → bash_command/output, Read+Write → file_path/content,
 * Edit → file_path/diff.
 */
function span(over: Partial<SpanDetail>): SpanDetail {
  return {
    spanId: "s1",
    parentSpanId: null,
    name: "claude_code.tool",
    type: "tool",
    startTimeMs: 1000,
    endTimeMs: 1500,
    durationMs: 500,
    status: "ok",
    input: null,
    output: null,
    params: {},
    events: [],
    ...over,
  } as unknown as SpanDetail;
}

function event(
  spanId: string,
  attributes: Record<string, string>,
  name = "tool.output",
) {
  return { spanId, name, attributes };
}

describe("indexToolSpansByUseId", () => {
  describe("given a Bash tool span with its tool.output event", () => {
    it("keys it by tool_use_id and takes the real command and stdout", () => {
      const index = indexToolSpansByUseId({
        spans: [
          span({
            spanId: "bash-1",
            durationMs: 2400,
            params: { tool_name: "Bash", tool_use_id: "toolu_1" },
          }),
        ],
        events: [
          event("bash-1", {
            bash_command: "pnpm test",
            output: "1 failed, 40 passed",
          }),
        ],
      });

      const ran = index.get("toolu_1");
      expect(ran?.toolName).toBe("Bash");
      expect(ran?.bashCommand).toBe("pnpm test");
      expect(ran?.output).toBe("1 failed, 40 passed");
      expect(ran?.durationMs).toBe(2400);
      expect(ran?.isError).toBe(false);
    });
  });

  describe("given the id only under the OTel GenAI attribute", () => {
    it("still keys the span, rather than dropping the tool call", () => {
      const index = indexToolSpansByUseId({
        spans: [
          span({
            params: { tool_name: "Read", "gen_ai.tool.call.id": "toolu_9" },
          }),
        ],
        events: [],
      });

      expect(index.get("toolu_9")?.toolName).toBe("Read");
    });
  });

  describe("given the tool body failed on the execution child", () => {
    // The outer `tool` span covers permission + execution, so it can read "ok"
    // while the body that actually ran failed.
    it("marks the tool call as errored", () => {
      const index = indexToolSpansByUseId({
        spans: [
          span({
            spanId: "tool-1",
            status: "ok",
            params: { tool_name: "Bash", tool_use_id: "toolu_2" },
          }),
          span({
            spanId: "exec-1",
            parentSpanId: "tool-1",
            name: "claude_code.tool.execution",
            status: "error",
          }),
        ],
        events: [],
      });

      expect(index.get("toolu_2")?.isError).toBe(true);
    });
  });

  describe("given the tool.output event landed on the execution child", () => {
    it("still finds the output", () => {
      const index = indexToolSpansByUseId({
        spans: [
          span({
            spanId: "tool-1",
            params: { tool_name: "Bash", tool_use_id: "toolu_3" },
          }),
          span({
            spanId: "exec-1",
            parentSpanId: "tool-1",
            name: "claude_code.tool.execution",
          }),
        ],
        events: [event("exec-1", { output: "done" })],
      });

      expect(index.get("toolu_3")?.output).toBe("done");
    });
  });

  describe("given a span with no tool_use_id", () => {
    it("is skipped — there is nothing in the transcript to match it to", () => {
      const index = indexToolSpansByUseId({
        spans: [span({ params: { tool_name: "Bash" } })],
        events: [],
      });

      expect(index.size).toBe(0);
    });
  });
});

describe("parsePatchHunks", () => {
  describe("given Edit's structured patch", () => {
    it("parses the hunks so the real diff can be shown", () => {
      const diff = JSON.stringify([
        { oldStart: 29, newStart: 29, lines: [" ctx", "+added", "-removed"] },
      ]);

      const hunks = parsePatchHunks(diff);

      expect(hunks).toHaveLength(1);
      expect(hunks?.[0]?.newStart).toBe(29);
      expect(hunks?.[0]?.lines).toContain("+added");
    });
  });

  describe("given a diff we cannot read", () => {
    it("returns null so the caller shows it raw rather than mangling it", () => {
      expect(parsePatchHunks("not json")).toBeNull();
      expect(parsePatchHunks(JSON.stringify({ nope: true }))).toBeNull();
      expect(parsePatchHunks(JSON.stringify([{ lines: [1, 2] }]))).toBeNull();
      expect(parsePatchHunks(null)).toBeNull();
    });
  });
});
