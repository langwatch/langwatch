import { describe, expect, it } from "vitest";
import { langyTranscriptRuns } from "~/features/langy/logic/langyTranscript";
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
      const text = '```json\n{"a": 1}\n```';
      expect(buildFinalAssistantParts({ text })).toEqual([
        { type: "text", text, role: "assistant" },
      ]);
    });
  });

  describe("given the turn's own account of what happened when", () => {
    const twoCalls = [
      { id: "c1", name: "search", output: "found" },
      { id: "c2", name: "run", output: "ok" },
    ];

    /** @scenario "The record keeps the paragraphs written between the calls" */
    it("records the paragraphs and the calls in the order they happened", () => {
      const parts = buildFinalAssistantParts({
        text: "Both are policy gaps.",
        toolCalls: twoCalls,
        order: [
          { kind: "text", text: "Reading the failed rows." },
          { kind: "tool", id: "c1" },
          { kind: "text", text: "Now running the candidate." },
          { kind: "tool", id: "c2" },
          { kind: "text", text: "Both are policy gaps." },
        ],
      });

      expect(parts.map((part) => part.type)).toEqual([
        "text",
        "tool-search",
        "text",
        "tool-run",
        "text",
      ]);
      expect(parts.map((part) => ("text" in part ? part.text : null))).toEqual([
        "Reading the failed rows.",
        null,
        "Now running the candidate.",
        null,
        "Both are policy gaps.",
      ]);
    });

    /** @scenario "The record keeps the paragraphs written between the calls" */
    it("keeps the reply once, not once per source", () => {
      const parts = buildFinalAssistantParts({
        text: "Done.",
        toolCalls: [twoCalls[0]!],
        order: [
          { kind: "tool", id: "c1" },
          { kind: "text", text: "Done." },
        ],
      });
      expect(parts.filter((part) => part.type === "text")).toHaveLength(1);
    });

    it("prefers the agent's own reply over the copy the stream caught", () => {
      // The last text on the stream is whatever had streamed when the turn
      // ended; `text` is the reply the agent asked to keep.
      const parts = buildFinalAssistantParts({
        text: "Improved the pass rate from 30% to 100%.",
        toolCalls: [twoCalls[0]!],
        order: [
          { kind: "tool", id: "c1" },
          { kind: "text", text: "Improved the pass ra" },
        ],
      });
      expect(parts).toEqual([
        {
          type: "tool-search",
          toolCallId: "c1",
          state: "output-available",
          output: "found",
        },
        {
          type: "text",
          text: "Improved the pass rate from 30% to 100%.",
          role: "assistant",
        },
      ]);
    });

    it("keeps a call the account never named, rather than dropping it", () => {
      const parts = buildFinalAssistantParts({
        text: "Done.",
        toolCalls: twoCalls,
        order: [
          { kind: "text", text: "Looking." },
          { kind: "tool", id: "c1" },
          { kind: "text", text: "Done." },
        ],
      });
      expect(parts.map((part) => part.type)).toEqual([
        "text",
        "tool-search",
        "tool-run",
        "text",
      ]);
    });

    /** @scenario "A turn that ends on a call does not repeat what it already wrote" */
    it("does not repeat its narration when the turn ended on a call", () => {
      // A turn that goes quiet after its last call hands over its WHOLE
      // narration as the reply, because there is no closing paragraph to hand
      // over instead. Appending it after the account would print every
      // paragraph a second time.
      const parts = buildFinalAssistantParts({
        text: "Reading the failed rows.\nNow running the candidate.",
        toolCalls: twoCalls,
        order: [
          { kind: "text", text: "Reading the failed rows." },
          { kind: "tool", id: "c1" },
          { kind: "text", text: "Now running the candidate." },
          { kind: "tool", id: "c2" },
        ],
      });

      expect(parts.map((part) => part.type)).toEqual([
        "text",
        "tool-search",
        "text",
        "tool-run",
      ]);
      expect(parts.map((part) => ("text" in part ? part.text : null))).toEqual([
        "Reading the failed rows.",
        null,
        "Now running the candidate.",
        null,
      ]);
    });

    /** @scenario "A turn that ends on a call does not repeat what it already wrote" */
    it("keeps the reply when a turn ending on a call wrote no prose of its own", () => {
      // Nothing was written between the calls, so `text` is the only prose
      // there is and dropping it would record a turn that said nothing.
      const parts = buildFinalAssistantParts({
        text: "Annotation added.",
        toolCalls: [twoCalls[0]!],
        order: [{ kind: "tool", id: "c1" }],
      });
      expect(parts.map((part) => part.type)).toEqual(["tool-search", "text"]);
    });

    it("drops a blank paragraph rather than recording an empty block", () => {
      const parts = buildFinalAssistantParts({
        text: "Done.",
        toolCalls: [twoCalls[0]!],
        order: [
          { kind: "text", text: "   " },
          { kind: "tool", id: "c1" },
          { kind: "text", text: "Done." },
        ],
      });
      expect(parts.map((part) => part.type)).toEqual(["tool-search", "text"]);
    });

    /** @scenario "A reloaded turn reads the same as the turn that was watched" */
    it("records a turn the panel reads back in the order it happened", () => {
      // The reload path end to end, minus the pixels: what the record keeps,
      // handed to the split the panel draws a turn with
      // (features/langy/logic/langyTranscript).
      const parts = buildFinalAssistantParts({
        text: "Both are policy gaps.",
        toolCalls: twoCalls,
        order: [
          { kind: "text", text: "Reading the failed rows." },
          { kind: "tool", id: "c1" },
          { kind: "text", text: "Now running the candidate." },
          { kind: "tool", id: "c2" },
          { kind: "text", text: "Both are policy gaps." },
        ],
      });

      expect(langyTranscriptRuns(parts).map((run) => run.kind)).toEqual([
        "answer",
        "activity",
        "answer",
        "activity",
        "answer",
      ]);
    });

    /** @scenario "A turn with no ordered account on hand records what it always did" */
    it("records its calls before its reply when there is no account", () => {
      const withoutOrder = buildFinalAssistantParts({
        text: "Done.",
        toolCalls: twoCalls,
      });
      const withEmptyOrder = buildFinalAssistantParts({
        text: "Done.",
        toolCalls: twoCalls,
        order: [],
      });
      expect(withEmptyOrder).toEqual(withoutOrder);
      expect(withoutOrder.map((part) => part.type)).toEqual([
        "tool-search",
        "tool-run",
        "text",
      ]);
    });
  });
});
