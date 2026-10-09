import { describe, expect, it } from "vitest";
import { langyRunText, langyTranscriptRuns } from "../langyTranscript";

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

      expect(runs.map((run) => run.kind)).toEqual([
        "answer",
        "activity",
        "answer",
      ]);
      expect(langyRunText(runs[0]!.parts)).toBe("Looking at the failures.");
      expect(langyRunText(runs[2]!.parts)).toBe("They are all timeouts.");
    });
  });

  describe("given lines said with the say tool between the calls", () => {
    const say = (id: string, value: string) => ({
      type: "tool-say",
      toolCallId: id,
      state: "output-available",
      input: { text: value },
      output: "Said.",
    });

    /** @scenario "A line said with the say tool is drawn where the call happened" */
    it("keeps each said line in its own run, in place, out of the activity", () => {
      const runs = langyTranscriptRuns([
        tool("t1"),
        tool("t2"),
        say("s1", "I found a LangGraph agent in app/graph.py."),
        say("s2", "I opened a pull request with the tracing change."),
        tool("t3"),
        say("s3", "All ready!"),
        text(""),
      ]);

      expect(runs.map((run) => run.kind)).toEqual([
        "activity",
        "say",
        "activity",
        "say",
        "answer",
      ]);
      expect(runs[0]!.parts).toHaveLength(2);
      expect(runs[1]!.parts).toHaveLength(2);
      expect(runs[3]!.parts).toHaveLength(1);
    });

    /** @scenario "A card raised by a call sits where the call ran" */
    it("ends the activity run on a question, so its card sits before the calls that follow the answer", () => {
      const question = {
        type: "tool-question",
        toolCallId: "q1",
        state: "output-available",
        input: {
          questions: [{ question: "Go?", options: [{ label: "Yes" }] }],
        },
        output: "answered",
      };
      const runs = langyTranscriptRuns([
        tool("t1"),
        question,
        tool("t2"),
        tool("t3"),
      ]);

      expect(runs.map((run) => run.kind)).toEqual(["activity", "activity"]);
      expect(runs[0]!.parts).toEqual([tool("t1"), question]);
      expect(runs[1]!.parts).toHaveLength(2);
    });
  });

  describe("given consecutive parts of the same kind", () => {
    it("keeps them in one run", () => {
      const runs = langyTranscriptRuns([
        tool("t1"),
        tool("t2"),
        text("first"),
        text("second"),
      ]);

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
