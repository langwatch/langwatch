/**
 * The turn's own account of what happened when, folded off its live stream.
 * This is what lets the record keep the paragraphs written BETWEEN the calls,
 * which live nowhere else once the stream lapses.
 */
import { describe, expect, it } from "vitest";
import type { LangyStreamEntry } from "../langyTokenBuffer";
import { turnAccountFromStream, turnOrderFromStream } from "../langyTurnOrder";

const delta = (text: string) => ({ type: "delta", text }) as LangyStreamEntry;
const tool = (id: string, phase: "start" | "end", name = "bash") =>
  ({ type: "tool", id, name, phase }) as unknown as LangyStreamEntry;

describe("turnOrderFromStream", () => {
  describe("given a turn that wrote, called, wrote again, and called again", () => {
    /** @scenario "The record keeps the paragraphs written between the calls" */
    it("returns the paragraphs and the calls in the order they happened", () => {
      expect(
        turnOrderFromStream([
          delta("Reading the failed rows."),
          tool("c1", "start"),
          tool("c1", "end"),
          delta("They are all policy gaps."),
          tool("c2", "start"),
          tool("c2", "end"),
        ]),
      ).toEqual([
        { kind: "text", text: "Reading the failed rows." },
        { kind: "tool", id: "c1" },
        { kind: "text", text: "They are all policy gaps." },
        { kind: "tool", id: "c2" },
      ]);
    });
  });

  describe("given prose that arrived in several chunks", () => {
    it("joins the chunks into the one paragraph they were written as", () => {
      expect(
        turnOrderFromStream([delta("Reading "), delta("the "), delta("rows.")]),
      ).toEqual([{ kind: "text", text: "Reading the rows." }]);
    });
  });

  describe("given a result that landed after the agent wrote more text", () => {
    /** @scenario "A card is recorded where the work began" */
    it("keeps the call at the point it started, above that text", () => {
      expect(
        turnOrderFromStream([
          tool("c1", "start"),
          delta("Waiting on the run."),
          tool("c1", "end"),
          delta("\n\nIt finished."),
        ]),
      ).toEqual([
        { kind: "tool", id: "c1" },
        // One paragraph: a result landing mid-sentence does not cut the text
        // in two, and the model's own line breaks are what separate it.
        { kind: "text", text: "Waiting on the run.\n\nIt finished." },
      ]);
    });
  });

  describe("given a call reported only as finished", () => {
    it("still gives it a place, where it was reported", () => {
      expect(
        turnOrderFromStream([delta("Checking."), tool("c9", "end")]),
      ).toEqual([
        { kind: "text", text: "Checking." },
        { kind: "tool", id: "c9" },
      ]);
    });
  });

  describe("given calls that overlapped", () => {
    it("records each one once, where it began", () => {
      expect(
        turnOrderFromStream([
          tool("a", "start"),
          tool("b", "start"),
          tool("a", "end"),
          tool("b", "end"),
        ]),
      ).toEqual([
        { kind: "tool", id: "a" },
        { kind: "tool", id: "b" },
      ]);
    });
  });

  describe("given the live-only signals a turn also carries", () => {
    it("holds no place for anything the record does not keep", () => {
      expect(
        turnOrderFromStream([
          { type: "status", status: "Thinking…" } as LangyStreamEntry,
          { type: "reasoning", text: "hmm" } as LangyStreamEntry,
          delta("Answer."),
          { type: "end" } as LangyStreamEntry,
        ]),
      ).toEqual([{ kind: "text", text: "Answer." }]);
    });
  });

  describe("given a turn with no stream to read", () => {
    it("returns no account, which is what the fallback shape reads as", () => {
      expect(turnOrderFromStream([])).toEqual([]);
    });
  });
});

describe("turnAccountFromStream", () => {
  describe("given a turn that wrote a plan, ran a call, and failed during another", () => {
    /** @scenario "A failed turn keeps the plan and the calls it ran as its message" */
    it("keeps the calls that returned, with their input and result, and the order", () => {
      const todos = [{ content: "Wire tracing in", status: "in_progress" }];
      const account = turnAccountFromStream([
        delta("Reading your agent first."),
        {
          type: "tool",
          id: "plan",
          name: "todowrite",
          phase: "start",
          input: { todos },
        },
        {
          type: "tool",
          id: "plan",
          name: "todowrite",
          phase: "end",
          output: "",
        },
        {
          type: "tool",
          id: "ls",
          name: "bash",
          phase: "start",
          input: { command: "ls" },
        },
        {
          type: "tool",
          id: "ls",
          name: "bash",
          phase: "end",
          output: "agent.py",
          isError: false,
        },
        {
          type: "tool",
          id: "cat",
          name: "bash",
          phase: "start",
          input: { command: "cat x" },
        },
      ]);

      expect(account.toolCalls).toEqual([
        { id: "plan", name: "todowrite", input: { todos }, output: "" },
        {
          id: "ls",
          name: "bash",
          input: { command: "ls" },
          output: "agent.py",
          isError: false,
        },
      ]);
      expect(account.order).toEqual([
        { kind: "text", text: "Reading your agent first." },
        { kind: "tool", id: "plan" },
        { kind: "tool", id: "ls" },
        { kind: "tool", id: "cat" },
      ]);
      expect(account.closingText).toBe("");
    });
  });

  describe("given a turn that ended on a paragraph", () => {
    it("names that paragraph as the closing text", () => {
      expect(
        turnAccountFromStream([
          tool("c1", "start"),
          tool("c1", "end"),
          delta("Almost there."),
        ]).closingText,
      ).toBe("Almost there.");
    });
  });
});
