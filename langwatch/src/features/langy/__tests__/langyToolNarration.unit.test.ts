import { describe, expect, it } from "vitest";
import { stripToolNarration } from "../logic/langyToolNarration";

const strip = (text: string, hasActivity = true) =>
  stripToolNarration({ text, hasActivity });

describe("stripToolNarration", () => {
  describe("given a turn that rendered activity cards", () => {
    describe("when narration and the answer share one paragraph", () => {
      // Both observed in the product. The first cut matched whole LINES and
      // missed both, because the model does not give its narration a line of
      // its own — it announces, states an intention, then answers.
      it("drops an announcement plus an intention, keeping the finding", () => {
        expect(
          strip(
            "Running the trace search and extracting latencies for the most recent 10 traces. I'll return a concise summary.\n\n10 traces.",
          ),
        ).toBe("10 traces.");
      });

      it("drops narration that names a skill mid-sentence", () => {
        expect(
          strip(
            "Searching traces via the agent-performance skill for traces dated in 2025 (assume full-year 2025). I'll load the skill and run its workflow.\n\nNo traces in 2025.",
          ),
        ).toBe("No traces in 2025.");
      });

      it("keeps a gerund sentence that reports rather than announces", () => {
        // The guard on the gerund rule: no work-noun, no ellipsis, so it is an
        // answer and stays.
        const text = "Running total is $45.02 across the period.";
        expect(strip(text)).toBe(text);
      });
    });

    describe("when the reply opens by naming the skill the card already names", () => {
      it("keeps only the answer", () => {
        expect(
          strip(
            "Using the agent-performance skill to search recent traces.\n\nNo traces in last 24h.",
          ),
        ).toBe("No traces in last 24h.");
      });
    });

    describe("when the reply opens with an intention", () => {
      it("drops the intention and keeps the finding", () => {
        expect(strip("I'll check the traces.\n14 traces in last 24h.")).toBe(
          "14 traces in last 24h.",
        );
        expect(strip("Let me look at that.\nAll green.")).toBe("All green.");
      });
    });

    describe("when the reply stacks several openers", () => {
      it("drops all of them", () => {
        expect(
          strip(
            "Using the GitHub skill.\n\nNow I'll open the PR.\n\nOpened PR #42.",
          ),
        ).toBe("Opened PR #42.");
      });
    });

    describe("when the reply echoes the command back", () => {
      it("drops the echoed invocation", () => {
        expect(
          strip("`langwatch trace search --format json`\n3 traces matched."),
        ).toBe("3 traces matched.");
      });
    });

    describe("when a gerund line trails off into an ellipsis", () => {
      it("treats it as announcing work, not reporting it", () => {
        expect(strip("Searching traces…\np95 is 1.2s.")).toBe("p95 is 1.2s.");
      });
    });
  });

  describe("given prose that reports rather than announces", () => {
    it("keeps a gerund line that states a result", () => {
      const text = "Searching found 3 traces over the threshold.";
      expect(strip(text)).toBe(text);
    });

    it("keeps a sentence that merely starts like an opener but carries content", () => {
      const text =
        "Using the p95 latency you asked about, the slowest span is db.query at 1.4s.";
      expect(strip(text)).toBe(text);
    });

    it("leaves narration that appears mid-answer alone", () => {
      const text = "14 traces in last 24h.\nUsing the analytics skill next.";
      expect(strip(text)).toBe(text);
    });
  });

  describe("given the reply is nothing BUT narration", () => {
    it("keeps it, because an empty bubble tells the user less than a repeated one", () => {
      const text = "Using the agent-performance skill to search recent traces.";
      expect(strip(text)).toBe(text);
    });
  });

  describe("given a turn with no activity to duplicate", () => {
    it("leaves the text untouched, since the narration may be the whole answer", () => {
      const text = "I'll need a project before I can look anything up.";
      expect(strip(text, false)).toBe(text);
    });
  });
});
