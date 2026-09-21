/**
 * How a chart axis writes a number, and why two of them differ.
 *
 * Every count panel on the cost screen used the abbreviating formatter, which
 * put "4.6k" on the conversations axis directly beside "3.4B" on the tokens
 * one. Those are not the same kind of quantity: a conversation is a thing
 * somebody had, and a reader comparing one quarter to the next wants the
 * figure, while a token count is throughput nobody holds in their head and
 * only the magnitude means anything. Formatting them alike made a few
 * thousand support chats read as a unit of machine consumption.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { describe, expect, it } from "vitest";

import { fmtCount, fmtWhole } from "../CostCharts";

describe("the count formatters", () => {
  /** @scenario "A count a person could tally is spelled out, never abbreviated" */
  it("spells out conversations and abbreviates tokens", () => {
    // The exact figure that started this: a quarter of conversations.
    expect(fmtWhole(4_600)).toBe("4,600");
    expect(fmtWhole(830)).toBe("830");
    // No suffix at any magnitude a tally reaches.
    expect(fmtWhole(28_800)).toBe("28,800");
    expect(fmtWhole(4_600)).not.toMatch(/[kMB]/);

    // Tokens keep the suffix, which is the whole reason the two are apart.
    expect(fmtCount(3_400_000_000)).toMatch(/[bB]$/);
  });
});
