/**
 * Unit tests for the rule that decides what a model is allowed to say.
 *
 * This is the property the whole feature rests on: a statement that cannot be
 * traced to the run does not reach the file. Everything here is deliberately
 * tested against hand-written model output rather than a real model, because
 * the contract has to hold for ANY output, including the outputs a model
 * produces on its worst day.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { describe, expect, it } from "vitest";
import { evidenceFixture } from "../../__tests__/evidence-fixture";
import type { Citation, Claim } from "../../report.types";
import {
  buildCitationIndex,
  humaniseRunIds,
  resolveClaims,
} from "../citation-resolver";

function claim(id: string, citations: Citation[]): Claim {
  return { id, text: `statement ${id}`, citations };
}

function resolve(claims: Claim[]) {
  return resolveClaims({
    claims,
    index: buildCitationIndex({ evidence: evidenceFixture() }),
  });
}

describe("buildCitationIndex()", () => {
  describe("given a run of three turns whose last two were shown", () => {
    it("admits the turns the model was actually given", () => {
      const index = buildCitationIndex({ evidence: evidenceFixture() });

      expect(index.has("turn:run_1:1")).toBe(true);
      expect(index.has("turn:run_1:2")).toBe(true);
    });

    /**
     * Turn 0 is real. It is also not in the truncated transcript, so a claim
     * citing it is describing something the model never read - which is the
     * fabrication this index exists to refuse, not a detail it can be lenient
     * about because the turn happens to exist.
     */
    /** @scenario A turn that does not exist is never pointed at */
    it("refuses a turn that exists but was truncated away", () => {
      const index = buildCitationIndex({ evidence: evidenceFixture() });

      expect(index.has("turn:run_1:0")).toBe(false);
    });

    /** @scenario A turn that does not exist is never pointed at */
    it("refuses a turn past the end of the conversation", () => {
      const index = buildCitationIndex({ evidence: evidenceFixture() });

      expect(index.has("turn:run_1:3")).toBe(false);
      expect(index.has("turn:run_1:99")).toBe(false);
    });

    /** @scenario A turn that does not exist is never pointed at */
    it("refuses every turn of a run whose conversation was not selected", () => {
      const index = buildCitationIndex({ evidence: evidenceFixture() });

      expect(index.has("run:run_2")).toBe(true);
      expect(index.has("turn:run_2:0")).toBe(false);
    });
  });

  describe("given statistics a claim might cite", () => {
    it("admits an allowlisted path and refuses anything else", () => {
      const index = buildCitationIndex({ evidence: evidenceFixture() });

      expect(index.has("stat:counts.failedCount")).toBe(true);
      expect(index.has("stat:batch.scenarioSetId")).toBe(false);
      expect(index.has("stat:__proto__")).toBe(false);
    });
  });
});

describe("resolveClaims()", () => {
  describe("when a statement cites something real", () => {
    it("keeps it", () => {
      const result = resolve([
        claim("a", [{ kind: "run", runId: "run_1" }]),
        claim("b", [{ kind: "criterion", criterionId: "c_known" }]),
        claim("c", [{ kind: "signature", signatureId: "s_known" }]),
      ]);

      expect(result.kept.map((it) => it.id)).toEqual(["a", "b", "c"]);
    });
  });

  describe("when a statement cites nothing", () => {
    /** @scenario A statement with nothing behind it is removed */
    it("drops it and counts it as uncited", () => {
      const result = resolve([claim("a", [])]);

      expect(result.kept).toEqual([]);
      expect(result.droppedUncited).toBe(1);
    });
  });

  describe("when a statement cites something that does not exist", () => {
    /** @scenario A statement citing a scenario that does not exist is removed */
    it("drops it and counts it as unresolvable", () => {
      const result = resolve([
        claim("a", [{ kind: "run", runId: "run_does_not_exist" }]),
      ]);

      expect(result.kept).toEqual([]);
      expect(result.droppedUnresolvable).toBe(1);
    });

    // Half a sentence's references being real does not make the sentence
    // trustworthy, so the whole thing goes rather than the bad citation.
    it("drops the whole statement even when its other citations resolve", () => {
      const result = resolve([
        claim("a", [
          { kind: "run", runId: "run_1" },
          { kind: "criterion", criterionId: "c_invented" },
        ]),
      ]);

      expect(result.kept).toEqual([]);
      expect(result.droppedUnresolvable).toBe(1);
    });
  });

  describe("when some statements are good and some are not", () => {
    it("keeps only the good ones", () => {
      const result = resolve([
        claim("good", [{ kind: "run", runId: "run_1" }]),
        claim("uncited", []),
        claim("invented", [{ kind: "signature", signatureId: "s_nope" }]),
      ]);

      expect(result.kept.map((it) => it.id)).toEqual(["good"]);
      expect(result.droppedUncited).toBe(1);
      expect(result.droppedUnresolvable).toBe(1);
    });
  });
});

describe("humaniseRunIds()", () => {
  const evidence = evidenceFixture();

  /**
   * The id is not lost — it is in the citation under the sentence, which is
   * where a reader who wants it looks. In the prose it is the same string
   * twice, and the half nobody can read.
   *
   * @scenario The report reads without knowing the system
   */
  it("names the scenario a run belongs to instead of its id", () => {
    const text = humaniseRunIds({
      text: "run_1 failed while run_2 passed.",
      evidence,
    });

    expect(text).toBe("Refund escalation failed while Happy path passed.");
    expect(text).not.toContain("run_1");
  });

  /** @scenario The report reads without knowing the system */
  it("leaves a sentence naming no run untouched", () => {
    expect(humaniseRunIds({ text: "Two scenarios failed.", evidence })).toBe(
      "Two scenarios failed.",
    );
  });

  /**
   * Substituting the shorter id first would leave the rest of the longer one
   * stranded on the page.
   *
   * @scenario The report reads without knowing the system
   */
  it("replaces the longest matching id first", () => {
    const nested = evidenceFixture({
      runs: [
        { ...evidence.runs[0]!, runId: "run_1", scenarioName: "Short" },
        { ...evidence.runs[1]!, runId: "run_10", scenarioName: "Long" },
      ],
    });

    expect(humaniseRunIds({ text: "run_10 failed.", evidence: nested })).toBe(
      "Long failed.",
    );
  });
});
