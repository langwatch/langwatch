// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  comparableName,
  isWorthScoring,
  nameSimilarity as compareNames,
  nameTokens,
  SUGGESTION_THRESHOLD,
} from "../name-similarity.rules.ts";

function nameSimilarity(left: string, right: string): number | null {
  const similarity = compareNames(left, right);
  return similarity.outcome === "scored" ? similarity.score : null;
}

describe("Feature: deciding which name pairs are worth comparing", () => {
  describe("given two names sharing no word", () => {
    /** @scenario "Two names sharing no word are never scored against each other" */
    it("discards the pair before any comparison is made", () => {
      expect(isWorthScoring("Maria Silva", "Jonas Bakker")).toBe(false);
      expect(nameSimilarity("Maria Silva", "Jonas Bakker")).toBeNull();
    });

    it("does not admit a pair merely because one name contains the other's letters", () => {
      expect(isWorthScoring("Daniel", "Alexandra")).toBe(false);
    });
  });

  describe("given two names of wildly different length", () => {
    /** @scenario "Names of wildly different length are never scored against each other" */
    it("discards the pair, because edit distance could not clear the bar anyway", () => {
      expect(isWorthScoring("silva", "silva de oliveira santos carvalho")).toBe(false);
    });
  });

  describe("given a shortened form of the same name", () => {
    it("admits the pair, which is the case the whole feature exists for", () => {
      expect(isWorthScoring("m.silva", "Maria Silva")).toBe(true);
    });
  });

  describe("given names made of single characters", () => {
    it("ignores initials, which are shared by unrelated people", () => {
      expect(nameTokens("M. J. Silva")).toEqual(new Set(["silva"]));
      expect(isWorthScoring("M. J. Adams", "R. J. Bakker")).toBe(false);
    });
  });

  describe("given a name that is really a mail address", () => {
    /** @scenario "An address is compared by the part that names the person" */
    it("compares the local part, so an address and a display name can match at all", () => {
      expect(isWorthScoring("maria.silva@acme.com", "Maria Silva")).toBe(true);
      expect(nameSimilarity("maria.silva@acme.com", "Maria Silva")).toBe(1);
    });

    /** @scenario "Two addresses on one company domain are not alike for sharing it" */
    it("does not let a shared domain admit two unrelated colleagues", () => {
      expect(isWorthScoring("maria.silva@acme.com", "jonas.bakker@acme.com")).toBe(false);
      expect(nameSimilarity("maria.silva@acme.com", "jonas.bakker@acme.com")).toBeNull();
    });

    it("keeps two colleagues who share only a first name below the bar", () => {
      const score = nameSimilarity("maria.silva@acme.com", "maria.bakker@acme.com");
      expect(score).not.toBeNull();
      expect(score).toBeLessThan(SUGGESTION_THRESHOLD);
    });

    it("treats one person's two addresses as the same person", () => {
      expect(nameSimilarity("maria.silva@acme.com", "maria.silva@other.example")).toBe(1);
    });

    it("leaves a text that merely starts with @ something to compare", () => {
      expect(comparableName("@mariasilva")).toBe("mariasilva");
    });
  });
});

describe("Feature: scoring how alike two names are", () => {
  it("scores an exact match, ignoring case and punctuation, as identical", () => {
    expect(nameSimilarity("Maria Silva", "maria-silva")).toBe(1);
  });

  describe("given a name a person would recognize as the same one", () => {
    it("scores it above the bar a suggestion has to clear", () => {
      const score = nameSimilarity("m.silva", "Maria Silva");
      expect(score).not.toBeNull();
      expect(score).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD);
    });
  });

  describe("given a name that barely resembles the other", () => {
    /** @scenario "A weak resemblance is not worth showing anybody" */
    it("scores it below the bar, so nobody is asked about it", () => {
      const score = nameSimilarity("Silva Jonas", "Silva Bakker");
      expect(score).not.toBeNull();
      expect(score).toBeLessThan(SUGGESTION_THRESHOLD);
    });
  });

  it("is symmetric, so which population is walked first cannot change a queue", () => {
    expect(nameSimilarity("m.silva", "Maria Silva")).toBe(nameSimilarity("Maria Silva", "m.silva"));
  });

  it("never scores outside the range the database will accept", () => {
    for (const [left, right] of [
      ["Maria Silva", "maria silva"],
      ["m.silva", "Maria Silva"],
      ["Silva Jonas", "Silva Bakker"],
    ] as const) {
      const score = nameSimilarity(left, right);
      expect(score).not.toBeNull();
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
