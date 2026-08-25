import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { TurnEventMapper, contentText, settledToolOutput } from "./events.js";
import { MAX_FIELD_BYTES, TRUNCATION_MARKER } from "./protocol.js";

describe("contentText", () => {
  it("joins the text blocks of a result", () => {
    expect(
      contentText({
        content: [
          { type: "text", text: "a" },
          { type: "image" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
    expect(contentText(undefined)).toBe("");
    expect(contentText({ content: "nope" })).toBe("");
  });
});

describe("settledToolOutput", () => {
  const scratchDirs: string[] = [];

  afterEach(() => {
    for (const dir of scratchDirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  describe("when pi truncated the tool output to a saved file", () => {
    it("recovers the full text from the file the details name", () => {
      const dir = mkdtempSync(join(tmpdir(), "langyworker-out-"));
      scratchDirs.push(dir);
      const full = join(dir, "pi-bash-full.log");
      const document = `{"traces":[{"id":"t1"}],"pagination":{"totalHits":44}}`;
      writeFileSync(full, document);
      const result = {
        content: [
          { type: "text", text: '"tail fragment only"\n[Showing lines 10-20 of 20]' },
        ],
        details: { truncation: { truncated: true }, fullOutputPath: full },
      };
      expect(settledToolOutput(result)).toBe(document);
    });

    it("falls back to the tail text when the file cannot be read", () => {
      const result = {
        content: [{ type: "text", text: "tail fragment" }],
        details: {
          truncation: { truncated: true },
          fullOutputPath: "/nonexistent/pi-bash.log",
        },
      };
      expect(settledToolOutput(result)).toBe("tail fragment");
    });
  });

  it("returns the content text untouched when nothing was truncated", () => {
    expect(settledToolOutput({ content: [{ type: "text", text: "plain" }] })).toBe(
      "plain",
    );
  });
});

describe("TurnEventMapper", () => {
  describe("when message_update deltas arrive", () => {
    it("maps text deltas to delta and thinking deltas to reasoning", () => {
      const mapper = new TurnEventMapper("t1");
      expect(
        mapper.map({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Hi" },
        }),
      ).toEqual([{ type: "delta", turnId: "t1", text: "Hi" }]);
      expect(
        mapper.map({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_delta", delta: "hm" },
        }),
      ).toEqual([{ type: "reasoning", turnId: "t1", text: "hm" }]);
      expect(
        mapper.map({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        }),
      ).toEqual([]);
    });
  });

  describe("when a tool executes", () => {
    it("maps start/update/end, replaying the recorded input on end", () => {
      const mapper = new TurnEventMapper("t1");
      const args = { command: "ls -la" };
      expect(
        mapper.map({
          type: "tool_execution_start",
          toolCallId: "c1",
          toolName: "bash",
          args,
        }),
      ).toEqual([
        { type: "tool_start", turnId: "t1", id: "c1", name: "bash", input: args },
      ]);
      expect(
        mapper.map({
          type: "tool_execution_update",
          toolCallId: "c1",
          toolName: "bash",
          args,
          partialResult: { content: [{ type: "text", text: "partial" }] },
        }),
      ).toEqual([
        { type: "tool_update", turnId: "t1", id: "c1", name: "bash", output: "partial" },
      ]);
      expect(
        mapper.map({
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "bash",
          isError: false,
          result: { content: [{ type: "text", text: "total 48" }] },
        }),
      ).toEqual([
        {
          type: "tool_end",
          turnId: "t1",
          id: "c1",
          name: "bash",
          input: args,
          isError: false,
          output: "total 48",
        },
      ]);
    });

    it("marks errored tools", () => {
      const mapper = new TurnEventMapper("t1");
      mapper.map({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "bash",
        args: {},
      });
      const [end] = mapper.map({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "bash",
        isError: true,
        result: { content: [{ type: "text", text: "exit 1" }] },
      });
      expect(end).toMatchObject({ type: "tool_end", isError: true, output: "exit 1" });
    });

    it("omits empty updates' output field", () => {
      const mapper = new TurnEventMapper("t1");
      const [update] = mapper.map({
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        partialResult: { content: [] },
      });
      expect(update).toEqual({
        type: "tool_update",
        turnId: "t1",
        id: "c1",
        name: "bash",
      });
    });
  });

  describe("when todowrite settles", () => {
    it("also emits a plan snapshot from its input", () => {
      const mapper = new TurnEventMapper("t1");
      const args = {
        todos: [{ content: "Find the slowest traces", status: "in_progress" }],
      };
      mapper.map({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "todowrite",
        args,
      });
      const events = mapper.map({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "todowrite",
        isError: false,
        result: { content: [{ type: "text", text: "[~] Find the slowest traces" }] },
      });
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        type: "plan",
        turnId: "t1",
        items: [{ content: "Find the slowest traces", status: "in_progress" }],
      });
    });

    it("emits no plan for an errored or empty todowrite", () => {
      const empty = new TurnEventMapper("t1");
      empty.map({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "todowrite",
        args: { todos: [] },
      });
      expect(
        empty.map({
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "todowrite",
          isError: false,
          result: { content: [] },
        }),
      ).toHaveLength(1);

      const errored = new TurnEventMapper("t1");
      errored.map({
        type: "tool_execution_start",
        toolCallId: "c2",
        toolName: "todowrite",
        args: { todos: [{ content: "Find the slowest traces", status: "in_progress" }] },
      });
      expect(
        errored.map({
          type: "tool_execution_end",
          toolCallId: "c2",
          toolName: "todowrite",
          isError: true,
          result: { content: [] },
        }),
      ).toHaveLength(1);
    });
  });

  describe("when a field is oversized", () => {
    it("bounds tool output at the 1MB cap with the marker", () => {
      const mapper = new TurnEventMapper("t1");
      mapper.map({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "read",
        args: {},
      });
      const [end] = mapper.map({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "read",
        isError: false,
        result: { content: [{ type: "text", text: "z".repeat(MAX_FIELD_BYTES + 100) }] },
      });
      if (end?.type !== "tool_end") throw new Error("expected a tool_end event");
      expect(Buffer.byteLength(end.output, "utf8")).toBeLessThanOrEqual(MAX_FIELD_BYTES);
      expect(end.output.endsWith(TRUNCATION_MARKER)).toBe(true);
    });
  });

  describe("when unrelated session events arrive", () => {
    it("maps nothing", () => {
      const mapper = new TurnEventMapper("t1");
      expect(mapper.map({ type: "agent_start" })).toEqual([]);
      expect(mapper.map({ type: "compaction_start" })).toEqual([]);
    });
  });
});
