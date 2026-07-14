import { describe, expect, it } from "vitest";
import {
  GLIMPSE_MAX_WORDS,
  latestCompleteClause,
  nextGlimpseFragment,
} from "../logic/langyReasoningGlimpse";

/**
 * The glimpse shows a THOUGHT, not a stutter: only complete clauses surface,
 * a thought never re-surfaces verbatim, and silence (no new words) produces
 * no glimpse at all.
 */

describe("latestCompleteClause", () => {
  describe("given reasoning that ends mid-thought", () => {
    it("returns the last COMPLETE clause, not the trailing words", () => {
      const clause = latestCompleteClause(
        "The spike is confined to one window. Let me check whether the slow",
      );
      expect(clause).toBe("The spike is confined to one window.");
    });

    it("returns null while the very first clause is still forming", () => {
      expect(latestCompleteClause("Looking at the analytics")).toBeNull();
    });
  });

  describe("given a breath (comma) partway through", () => {
    it("completes at the comma once the clause can stand alone", () => {
      const clause = latestCompleteClause(
        "the top twenty all carry at least one retry span, so the",
      );
      expect(clause).toBe(
        "the top twenty all carry at least one retry span,",
      );
    });

    it("does not break at a comma in a short fragment", () => {
      expect(latestCompleteClause("Right, so")).toBeNull();
    });
  });

  describe("given a long run with no punctuation", () => {
    it("completes at the hard word cap so an unpunctuated model still glimpses", () => {
      const words = Array.from({ length: 15 }, (_, i) => `w${i}`).join(" ");
      const clause = latestCompleteClause(words);
      expect(clause).toBe(
        Array.from({ length: 12 }, (_, i) => `w${i}`).join(" "),
      );
    });
  });
});

describe("nextGlimpseFragment", () => {
  const reasoning =
    "the retries account for almost all of the added latency. Checking the slow";

  describe("given a new complete thought since the last glimpse", () => {
    it("shows it, trimmed to the freshest words with a leading ellipsis", () => {
      const result = nextGlimpseFragment({
        reasoning,
        lastClauseShown: null,
        lastReasoningLength: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.fragment.startsWith("…")).toBe(true);
      // "…" + the clause's final 8 words, as one token-joined string.
      expect(result!.fragment.replace("…", "").split(" ")).toHaveLength(
        GLIMPSE_MAX_WORDS,
      );
      expect(result!.fragment).toContain("added latency.");
    });

    it("shows a short thought whole, without an ellipsis", () => {
      const result = nextGlimpseFragment({
        reasoning: "That lines up.",
        lastClauseShown: null,
        lastReasoningLength: 0,
      });
      expect(result!.fragment).toBe("That lines up.");
    });
  });

  describe("given the same thought is still the latest", () => {
    it("falls back to a taste of the freshest words when new words arrived", () => {
      const first = nextGlimpseFragment({
        reasoning,
        lastClauseShown: null,
        lastReasoningLength: 0,
      })!;
      const grown = reasoning + " traces for anything they share";
      const second = nextGlimpseFragment({
        reasoning: grown,
        lastClauseShown: first.clause,
        lastReasoningLength: reasoning.length,
      });
      expect(second).not.toBeNull();
      expect(second!.fragment).toBe("…for anything they share…");
      // The clause pointer is kept so the SAME thought still never re-surfaces.
      expect(second!.clause).toBe(first.clause);
    });

    it("produces no glimpse at all when nothing new arrived", () => {
      const first = nextGlimpseFragment({
        reasoning,
        lastClauseShown: null,
        lastReasoningLength: 0,
      })!;
      const again = nextGlimpseFragment({
        reasoning,
        lastClauseShown: first.clause,
        lastReasoningLength: reasoning.length,
      });
      expect(again).toBeNull();
    });
  });
});
