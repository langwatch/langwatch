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
import {
  azureBillingNoteSentence,
  laneTrendBadge,
  laneTrendPct,
} from "../costLaneFormat";

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

/**
 * The change figure beside a lane card's total.
 *
 * Halves rather than last-point-against-previous, and the reason is that the
 * series arrives at whatever granularity the read answers in: days from a real
 * summary, months from an invented one. A last-point comparison would mean a
 * different thing on every screen it appeared on, while measuring mostly the
 * noise of a single day.
 */
describe("laneTrendPct", () => {
  /** @scenario "A lane card says which way its window is running" */
  it("reports the later half as a percentage of the earlier half", () => {
    const points = [
      { value: 100 },
      { value: 100 },
      { value: 150 },
      { value: 150 },
    ];

    expect(laneTrendPct(points)).toBe(50);
    expect(laneTrendBadge(laneTrendPct(points))).toBe("+50%");
  });

  it("reports a fall as a negative, and a flat window as level", () => {
    expect(
      laneTrendPct([
        { value: 200 },
        { value: 200 },
        { value: 100 },
        { value: 100 },
      ]),
    ).toBe(-50);
    expect(
      laneTrendBadge(
        laneTrendPct([
          { value: 100 },
          { value: 100 },
          { value: 100 },
          { value: 100 },
        ]),
      ),
    ).toBe("level");
  });

  /** @scenario "A window too short to compare halves reports no change at all" */
  it("answers nothing rather than a figure drawn from too little", () => {
    expect(laneTrendPct([{ value: 100 }, { value: 400 }])).toBeNull();
    expect(laneTrendBadge(null)).toBeNull();
    // An earlier half of nothing has no percentage to report: every figure is
    // an infinite rise on it, which is true and tells the reader nothing.
    expect(
      laneTrendPct([
        { value: 0 },
        { value: 0 },
        { value: 900 },
        { value: 900 },
      ]),
    ).toBeNull();
  });

  /** @scenario "A day whose figure is withheld is left out of the change, never counted as zero" */
  it("skips a withheld day instead of counting it as nothing spent", () => {
    const withheld = [
      { value: 100 },
      { value: null },
      { value: 100 },
      { value: 150 },
      { value: 150 },
    ];
    const withoutIt = [
      { value: 100 },
      { value: 100 },
      { value: 150 },
      { value: 150 },
    ];

    // Counted as a zero, the withheld day would drag the earlier half down and
    // report a rise that never happened.
    expect(laneTrendPct(withheld)).toBe(laneTrendPct(withoutIt));
  });
});
