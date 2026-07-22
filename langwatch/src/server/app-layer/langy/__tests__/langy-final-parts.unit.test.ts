import { describe, expect, it } from "vitest";
import { buildFinalAssistantParts } from "../langy-final-parts";

/** A well-formed stats block, fenced the way the model emits it. */
const statsFence = [
  "```langy-card",
  '{"kind": "stats", "blockId": "b1", "items": [{"label": "p95", "value": 812, "unit": "ms"}]}',
  "```",
].join("\n");

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
            input: {
              command: "langwatch trace search --limit 2 --format json",
            },
            output:
              '✔ Found 2\n{"traces":[{"trace_id":"trace_1"},{"trace_id":"trace_2"}],"pagination":{"totalHits":34}}',
          },
        ],
      });

      expect(parts[0]).toMatchObject({
        type: "tool-langwatch.trace.search",
        toolCallId: "t1",
        state: "output-available",
        // Output is the canonical card envelope used by both live and durable
        // tool parts, rather than the pre-envelope raw document.
        output: JSON.stringify({
          kind: "card",
          card: "traces",
          payload: {
            traces: [{ trace_id: "trace_1" }, { trace_id: "trace_2" }],
            pagination: { totalHits: 34 },
          },
        }),
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

  // =========================================================================
  // The relay stamp — ```langy-card fences become typed parts (ADR-060 §1)
  // =========================================================================

  describe("given a well-formed block between prose", () => {
    it("stamps a typed langy-card part in place, prose kept on either side", () => {
      const parts = buildFinalAssistantParts({
        text: `Here you go:\n${statsFence}\nAnd that is the picture.`,
      });
      expect(parts).toEqual([
        { type: "text", text: "Here you go:", role: "assistant" },
        {
          type: "langy-card",
          blockId: "b1",
          kind: "stats",
          provenance: "derived",
          card: {
            kind: "stats",
            blockId: "b1",
            items: [{ label: "p95", value: 812, unit: "ms" }],
          },
        },
        { type: "text", text: "And that is the picture.", role: "assistant" },
      ]);
    });

    it("lifts the block's hints onto the part", () => {
      const fence = [
        "```langy-card",
        '{"kind": "stats", "blockId": "b1", "items": [{"label": "a", "value": 1}], "hints": [{"type": "verify"}]}',
        "```",
      ].join("\n");
      const parts = buildFinalAssistantParts({ text: fence });
      expect(parts[0]).toMatchObject({
        type: "langy-card",
        hints: [{ type: "verify" }],
      });
    });
  });

  describe("given a block whose JSON was cut off with unclosed brackets", () => {
    it("salvages it into a document that validates, and stamps the card", () => {
      const truncated = [
        "```langy-card",
        '{"kind": "stats", "blockId": "b1", "items": [{"label": "p95", "value": 812',
        "```",
      ].join("\n");
      const parts = buildFinalAssistantParts({ text: truncated });
      expect(parts).toEqual([
        {
          type: "langy-card",
          blockId: "b1",
          kind: "stats",
          provenance: "derived",
          card: {
            kind: "stats",
            blockId: "b1",
            items: [{ label: "p95", value: 812 }],
          },
        },
      ]);
    });
  });

  describe("given a block that validates nowhere", () => {
    it("records a langy-card-failed part carrying the raw text — never silent", () => {
      const bad = [
        "before",
        "```langy-card",
        "this is not json",
        "```",
        "after",
      ].join("\n");
      const parts = buildFinalAssistantParts({ text: bad });
      expect(parts).toEqual([
        { type: "text", text: "before", role: "assistant" },
        {
          type: "langy-card-failed",
          blockId: "failed-block-1",
          raw: "this is not json",
        },
        { type: "text", text: "after", role: "assistant" },
      ]);
    });

    it("treats a resource-shaped kind as a failed block, drawing no card", () => {
      const spoofed = [
        "```langy-card",
        '{"kind": "traces", "blockId": "b1", "traces": [{"trace_id": "tr_fake"}]}',
        "```",
      ].join("\n");
      const parts = buildFinalAssistantParts({ text: spoofed });
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({
        type: "langy-card-failed",
        raw: expect.stringContaining("tr_fake") as string,
      });
    });

    it("mints deterministic failed ids so both finalize paths stamp identically", () => {
      const twoBad = [
        "```langy-card",
        "junk one",
        "```",
        "```langy-card",
        "junk two",
        "```",
      ].join("\n");
      const first = buildFinalAssistantParts({ text: twoBad });
      const second = buildFinalAssistantParts({ text: twoBad });
      expect(first).toEqual(second);
      expect(first.map((p) => p.blockId)).toEqual([
        "failed-block-1",
        "failed-block-2",
      ]);
    });
  });

  describe("given a fence inside TOOL output", () => {
    it("keeps it as raw text in the tool part — tool results are never scanned", () => {
      const parts = buildFinalAssistantParts({
        text: "summary",
        toolCalls: [
          { id: "t1", name: "bash", output: `tenant data:\n${statsFence}` },
        ],
      });
      expect(parts).toEqual([
        {
          type: "tool-bash",
          toolCallId: "t1",
          state: "output-available",
          output: `tenant data:\n${statsFence}`,
        },
        { type: "text", text: "summary", role: "assistant" },
      ]);
      expect(parts.some((p) => p.type === "langy-card")).toBe(false);
    });
  });

  describe("given fence-less text", () => {
    it("records exactly the single text part it always did", () => {
      expect(buildFinalAssistantParts({ text: "" })).toEqual([
        { type: "text", text: "", role: "assistant" },
      ]);
      expect(
        buildFinalAssistantParts({ text: "plain prose\nwith lines" }),
      ).toEqual([
        { type: "text", text: "plain prose\nwith lines", role: "assistant" },
      ]);
    });

    it("leaves an ordinary code fence alone — only langy-card fences stamp", () => {
      const text = "```json\n{\"a\": 1}\n```";
      expect(buildFinalAssistantParts({ text })).toEqual([
        { type: "text", text, role: "assistant" },
      ]);
    });
  });
});
