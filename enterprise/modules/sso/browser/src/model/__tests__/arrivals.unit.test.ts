// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One question asked in two places. Both surfaces claimed a shared list in a
 * comment and neither held it: the order was mirrored, so the answer a reader
 * had already chosen sat in a different place the second time.
 *
 * No scenario annotation: the screens are bound on their own scenarios. This
 * is the list underneath them, and what it pins is the order and the mapping.
 */
import { describe, expect, it } from "vitest";

import {
  ARRIVAL_ANSWERS,
  ARRIVAL_COPY,
  arrivalAnswerLabel,
  SSO_ANSWER_BY_POLICY,
  SSO_POLICY_BY_ANSWER,
} from "../arrivals.ts";

describe("given the two cards that ask who gets in", () => {
  describe("when either renders its answers", () => {
    it("offers them closed to open, so the deliberate choice is last", () => {
      expect(ARRIVAL_ANSWERS).toEqual(["closed", "approve", "open"]);
    });

    it("gives every answer a label and a help line, so neither card writes its own", () => {
      for (const answer of ARRIVAL_ANSWERS) {
        expect(ARRIVAL_COPY[answer].label.length).toBeGreaterThan(0);
        expect(ARRIVAL_COPY[answer].help.length).toBeGreaterThan(0);
      }
    });

    it("says the widest answer rests on a verified domain and approves nobody", () => {
      // Each card told one half of this and a reader comparing them learned
      // that one option meant two different things.
      expect(ARRIVAL_COPY.open.help).toContain("verified");
      expect(ARRIVAL_COPY.open.help).toContain("Nobody approves each person");
    });

    it("names a finished step by the label alone", () => {
      expect(arrivalAnswerLabel("approve")).toBe(ARRIVAL_COPY.approve.label);
    });
  });
});

describe("given the connection door's own three-valued policy", () => {
  describe("when an answer is mapped onto it and back", () => {
    it("round-trips, so neither direction can drift from the other", () => {
      for (const answer of ARRIVAL_ANSWERS) {
        expect(SSO_ANSWER_BY_POLICY[SSO_POLICY_BY_ANSWER[answer]]).toBe(answer);
      }
    });

    it("keeps the middle answer as itself rather than collapsing it to a boolean", () => {
      expect(SSO_POLICY_BY_ANSWER.approve).toBe("request");
      expect(SSO_ANSWER_BY_POLICY.request).toBe("approve");
    });
  });
});
