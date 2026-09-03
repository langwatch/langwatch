import { describe, expect, it } from "vitest";
import { langyRunText, langyTranscriptRuns } from "../langy-transcript";

const text = (value: string) => ({ type: "text", text: value });
const tool = (id: string) => ({
  type: "tool-bash",
  toolCallId: id,
  state: "output-available",
  input: { command: "ls" },
  output: "ok",
});

describe("langyTranscriptRuns", () => {
  describe("given a turn that wrote, ran a call, and wrote again", () => {
    /** @scenario "A tool card sits between the paragraphs it ran between" */
    it("returns the runs in the order they happened", () => {
      const runs = langyTranscriptRuns([
        text("Looking at the failures."),
        tool("t1"),
        text("They are all timeouts."),
      ]);

      expect(runs.map((run) => run.kind)).toEqual(["answer", "activity", "answer"]);
      expect(langyRunText(runs[0]!.parts)).toBe("Looking at the failures.");
      expect(langyRunText(runs[2]!.parts)).toBe("They are all timeouts.");
    });
  });

  describe("given consecutive parts of the same kind", () => {
    it("keeps them in one run", () => {
      const runs = langyTranscriptRuns([tool("t1"), tool("t2"), text("first"), text("second")]);

      expect(runs).toHaveLength(2);
      expect(runs[0]!.parts).toHaveLength(2);
      expect(langyRunText(runs[1]!.parts)).toBe("first\n\nsecond");
    });
  });

  describe("given a reasoning part between two paragraphs", () => {
    // Thinking is not the answer and renders nowhere in the transcript, so it
    // must not split the reply: a seam here would put a paragraph break in the
    // middle of a sentence the model was still writing.
    it("does not split the answer run", () => {
      const runs = langyTranscriptRuns([
        text("Half a "),
        { type: "reasoning", text: "considering the options" },
        text("sentence."),
      ]);

      expect(runs).toHaveLength(1);
      expect(runs[0]!.kind).toBe("answer");
    });
  });

  describe("given a card block stamped into the reply", () => {
    it("keeps it in the answer run, not in the activity around it", () => {
      const runs = langyTranscriptRuns([
        text("Here is the cost."),
        { type: "langy-card", card: { kind: "stats" } },
        tool("t1"),
      ]);

      expect(runs.map((run) => run.kind)).toEqual(["answer", "activity"]);
      expect(runs[0]!.parts).toHaveLength(2);
    });
  });

  describe("given a turn with nothing in it", () => {
    it("returns no runs", () => {
      expect(langyTranscriptRuns([])).toEqual([]);
    });
  });
});

describe("langyRunText", () => {
  describe("given parts that are not text", () => {
    it("reads only the prose", () => {
      expect(langyRunText([tool("t1"), text("only this")])).toBe("only this");
    });
  });

  describe("given an empty text part", () => {
    it("drops it rather than opening a paragraph break", () => {
      expect(langyRunText([text(""), text("kept")])).toBe("kept");
    });
  });
});
