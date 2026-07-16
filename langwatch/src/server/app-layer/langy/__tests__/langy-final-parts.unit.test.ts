import { describe, expect, it } from "vitest";
import { buildFinalAssistantParts } from "../langy-final-parts";

describe("buildFinalAssistantParts", () => {
  describe("given text and no tool calls", () => {
    it("returns a single assistant text part", () => {
      const parts = buildFinalAssistantParts({ text: "hello world" });
      expect(parts).toEqual([
        { type: "text", text: "hello world", role: "assistant" },
      ]);
    });
  });

  describe("given tool calls", () => {
    it("places the tool parts BEFORE the text so a reload replays cards then prose", () => {
      const parts = buildFinalAssistantParts({
        text: "done",
        toolCalls: [
          { id: "t1", name: "search", input: { q: "x" }, output: "found" },
        ],
      });
      expect(parts).toEqual([
        {
          type: "tool-search",
          toolCallId: "t1",
          state: "output-available",
          input: { q: "x" },
          output: "found",
        },
        { type: "text", text: "done", role: "assistant" },
      ]);
    });

    it("maps an errored tool call to output-error with errorText from output", () => {
      const parts = buildFinalAssistantParts({
        text: "",
        toolCalls: [{ id: "t1", name: "run", isError: true, output: "boom" }],
      });
      expect(parts[0]).toEqual({
        type: "tool-run",
        toolCallId: "t1",
        state: "output-error",
        errorText: "boom",
      });
    });

    it("defaults a missing output to an empty string / generic error text", () => {
      const ok = buildFinalAssistantParts({
        text: "",
        toolCalls: [{ id: "a", name: "x" }],
      });
      expect(ok[0]).toMatchObject({ state: "output-available", output: "" });

      const bad = buildFinalAssistantParts({
        text: "",
        toolCalls: [{ id: "b", name: "y", isError: true }],
      });
      expect(bad[0]).toMatchObject({
        state: "output-error",
        errorText: "Tool call failed",
      });
    });

    it("records a bash LangWatch CLI call as the capability, with its digest", () => {
      const parts = buildFinalAssistantParts({
        text: "found them",
        toolCalls: [
          {
            id: "t1",
            name: "bash",
            input: { command: "langwatch trace search --limit 2 --format json" },
            output:
              '✔ Found 2\n{"traces":[{"trace_id":"trace_1"},{"trace_id":"trace_2"}],"pagination":{"totalHits":34}}',
          },
        ],
      });

      expect(parts[0]).toMatchObject({
        type: "tool-langwatch.trace.search",
        toolCallId: "t1",
        state: "output-available",
        // Output reduced to the document — the reduced/text fallback tier.
        output:
          '{"traces":[{"trace_id":"trace_1"},{"trace_id":"trace_2"}],"pagination":{"totalHits":34}}',
        // The digest — the reference the card hydrates fresh data from.
        digest: {
          resource: "trace",
          verb: "search",
          strategy: "id-ref",
          ids: ["trace_1", "trace_2"],
          counts: { returned: 2, total: 34 },
          query: { limit: "2", format: "json" },
        },
      });
    });

    it("preserves tool-call order", () => {
      const parts = buildFinalAssistantParts({
        text: "t",
        toolCalls: [
          { id: "1", name: "a" },
          { id: "2", name: "b" },
        ],
      });
      expect(parts.map((p) => p.type)).toEqual(["tool-a", "tool-b", "text"]);
    });
  });
});
