/**
 * How the gateway reads one socket message: a frame, a result it cannot read
 * (naming the call and the field), or nothing to act on.
 * @see specs/agents/connected-agents.feature
 */
import { describe, expect, it } from "vitest";

import { readSdkFrame } from "../connected-agent-frame.rules.ts";

const resultFrame = (fields: Record<string, unknown>) =>
  JSON.stringify({ protocol: 1, type: "result", callId: "call_1", ...fields });

describe("readSdkFrame()", () => {
  describe("when a result's output is a dict of fields with no role", () => {
    /** @scenario "A result frame the platform cannot read names the field it failed on" */
    it("is an unreadable result for that call, naming output.role", () => {
      const read = readSdkFrame(
        resultFrame({
          output: { output: "Order 42 ships today", thread_id: "t1", order_number: null },
        }),
      );

      expect(read).toMatchObject({ kind: "unreadable_result", callId: "call_1" });
      expect(read.kind === "unreadable_result" && read.issue).toMatch(/^output\.role: /);
    });

    it("names the item when the output is a list of plain strings", () => {
      const read = readSdkFrame(resultFrame({ output: ["hello"] }));

      expect(read).toMatchObject({
        kind: "unreadable_result",
        callId: "call_1",
        issue: expect.stringMatching(/^output\.0: /),
      });
    });
  });

  describe("when a result carries both an output and an error", () => {
    it("is an unreadable result with the refinement's message", () => {
      const read = readSdkFrame(resultFrame({ output: "ok", error: { code: "x", message: "y" } }));

      expect(read).toEqual({
        kind: "unreadable_result",
        callId: "call_1",
        issue: "A result carries an output or an error, and never both",
      });
    });
  });

  describe("when the frame names no call, or is not a result", () => {
    it("is dropped", () => {
      expect(readSdkFrame(resultFrame({ callId: "", output: {} }))).toEqual({ kind: "dropped" });
      expect(readSdkFrame(JSON.stringify({ protocol: 1, type: "ack", callId: 7 }))).toEqual({
        kind: "dropped",
      });
      expect(readSdkFrame("not json")).toEqual({ kind: "dropped" });
    });
  });

  describe("when the frame is well formed", () => {
    it("is the parsed frame", () => {
      expect(
        readSdkFrame(resultFrame({ output: { role: "assistant", content: "hi" } })),
      ).toMatchObject({ kind: "frame", frame: { type: "result", callId: "call_1" } });
      expect(
        readSdkFrame(JSON.stringify({ protocol: 1, type: "ack", callId: "call_1" })),
      ).toMatchObject({ kind: "frame", frame: { type: "ack" } });
    });
  });
});
