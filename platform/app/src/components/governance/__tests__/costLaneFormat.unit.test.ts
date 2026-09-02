/**
 * The billed lane's Azure billing sentences.
 *
 * The DECISION — which note applies — is tested beside `azureBillingNoteFrom`
 * in `@ee`; these are the words each note renders as. Every sentence explains
 * an ABSENCE, so the one thing this copy must never do is put a figure, or
 * anything that reads as one, where the bill put nothing.
 *
 * Spec: specs/governance/azure-billing-identity.feature
 * Decision: ADR-128 §21.3, §21.4 (v3.4).
 */

import { describe, expect, it } from "vitest";
import { azureBillingNoteSentence } from "../costLaneFormat";

describe("azureBillingNoteSentence", () => {
  /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
  it("explains that prepaid packs never appear on the bill", () => {
    const sentence = azureBillingNoteSentence("prepaid_declared");
    // The claim itself, not just the two words somewhere in the copy: a
    // sentence saying the opposite ("prepaid packs appear on the bill")
    // would pass a bare /prepaid/ + /bill/ pair of matches.
    expect(sentence).toMatch(/prepaid.*never appear.*bill/i);
    expect(sentence).toMatch(/expected/i);
  });

  /** @scenario "A tenant that declared nothing is never told it is prepaid" */
  it("says the bill holds nothing without ever mentioning prepaid", () => {
    const sentence = azureBillingNoteSentence("no_spend_recorded");
    // "was read" is load-bearing: only a completed read licenses this
    // sentence, and the copy must say so rather than assert a bare absence.
    expect(sentence).toMatch(/was read/i);
    expect(sentence).toMatch(/no .*charges/i);
    expect(sentence).not.toMatch(/prepaid/i);
  });

  it("reports a failed read as missing data, never as an empty bill", () => {
    const sentence = azureBillingNoteSentence("billing_read_failed");
    expect(sentence).toMatch(/could not|failed/i);
    expect(sentence).toMatch(/missing/i);
    expect(sentence).not.toMatch(/no .*charges|nothing .*billed/i);
  });

  it("keeps every sentence free of digits, so none can read as a figure", () => {
    for (const note of [
      "prepaid_declared",
      "no_spend_recorded",
      "billing_read_failed",
    ] as const) {
      expect(azureBillingNoteSentence(note)).not.toMatch(/\d/);
    }
  });
});
