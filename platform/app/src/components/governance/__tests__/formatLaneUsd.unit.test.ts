/**
 * How a cost lane renders its money, and how a seat pool renders its name.
 *
 * The lane headline is the largest figure on the Costs screen and it was
 * printing `$227999.00` — six unbroken digits, because the formatter behind it
 * was built for per-request gateway costs in the $0.0001 range, where
 * thousands separators never come up. Both ends of that scale end up in the
 * same function, so the boundaries between its bands are what these tests pin
 * down.
 */

import { describe, expect, it } from "vitest";
import {
  formatLaneCurrencyTotal,
  formatLaneUsd,
  seatPoolName,
} from "../costLaneFormat";

describe("formatLaneUsd", () => {
  it("groups a bill-sized amount and drops the cents", () => {
    // At four figures the cents are below anything a reader acts on, and they
    // cost three characters on the biggest number on the page.
    expect(formatLaneUsd(227_999)).toBe("$227,999");
    expect(formatLaneUsd(172_858.42)).toBe("$172,858");
  });

  it("keeps the cents on an amount small enough for them to be the figure", () => {
    expect(formatLaneUsd(1)).toBe("$1.00");
    expect(formatLaneUsd(999.99)).toBe("$999.99");
  });

  it("switches bands at a thousand", () => {
    // The boundary itself, because this is the interesting part of the split.
    expect(formatLaneUsd(999.5)).toBe("$999.50");
    expect(formatLaneUsd(1000)).toBe("$1,000");
  });

  it("keeps sub-cent precision below a dollar", () => {
    // The reason the underlying formatter exists: rounding this to $0.00 would
    // lose the difference between nearly nothing and nothing.
    expect(formatLaneUsd(0.000165)).toBe("$0.000165");
  });

  it("reads a refund the way a bill reads it, with the sign out front", () => {
    expect(formatLaneUsd(-12.5)).toBe("-$12.50");
    expect(formatLaneUsd(-227_999)).toBe("-$227,999");
  });

  it("answers an em dash when no figure is held, never a zero", () => {
    // A zero would be a claim that nothing was spent, which an unread lane
    // does not know.
    expect(formatLaneUsd(null)).toBe("—");
  });

  it("shows a measured zero as a zero", () => {
    expect(formatLaneUsd(0)).toBe("$0.00");
  });
});

/**
 * The same three bands with the currency named instead of symbolised.
 *
 * Two totals sit on one card — the dollar headline and a line per other
 * currency — and a card where they round differently is a card that says one
 * of them is smaller than it is. So each band is pinned against its dollar
 * twin above, at the same amounts.
 */
describe("formatLaneCurrencyTotal", () => {
  it("groups a bill-sized amount and drops the cents, as the dollar figure does", () => {
    expect(
      formatLaneCurrencyTotal({ currencyCode: "EUR", amount: 227_999 }),
    ).toBe("EUR 227,999");
  });

  it("keeps the cents on an amount small enough for them to be the figure", () => {
    expect(
      formatLaneCurrencyTotal({ currencyCode: "EUR", amount: 999.99 }),
    ).toBe("EUR 999.99");
    expect(formatLaneCurrencyTotal({ currencyCode: "EUR", amount: 1000 })).toBe(
      "EUR 1,000",
    );
  });

  it("keeps sub-unit precision below one, rather than rounding it to a zero", () => {
    // The gateway lane's own scale. Rounded to cents this reads `EUR 0.00`,
    // which says a currency nothing was spent in, beside a dollar figure of
    // the same size reading `$0.000165`.
    expect(
      formatLaneCurrencyTotal({ currencyCode: "EUR", amount: 0.000165 }),
    ).toBe("EUR 0.000165");
    expect(
      formatLaneCurrencyTotal({ currencyCode: "EUR", amount: 0.004 }),
    ).toBe("EUR 0.004");
  });

  it("shows a measured zero as a zero, so a retracted amount can be stated", () => {
    expect(formatLaneCurrencyTotal({ currencyCode: "EUR", amount: 0 })).toBe(
      "EUR 0.00",
    );
  });

  it("answers an em dash when no figure is held", () => {
    expect(formatLaneCurrencyTotal({ currencyCode: "EUR", amount: null })).toBe(
      "EUR —",
    );
  });

  it("reads a refund with the sign out front", () => {
    expect(
      formatLaneCurrencyTotal({ currencyCode: "EUR", amount: -12.5 }),
    ).toBe("EUR -12.50");
  });

  it("says so plainly when the read named no currency at all", () => {
    expect(formatLaneCurrencyTotal({ currencyCode: "", amount: 40 })).toBe(
      "No currency named 40.00",
    );
  });

  it("carries no currency symbol, so the code is the only thing naming it", () => {
    // A dollar sign left on by the sub-unit band would put two currencies on
    // one line: `EUR $0.000165`.
    expect(
      formatLaneCurrencyTotal({ currencyCode: "EUR", amount: 0.000165 }),
    ).not.toMatch(/\$/);
  });
});

describe("seatPoolName", () => {
  it("gives a known SKU the product name, capitalised as the vendor writes it", () => {
    // "GitHub", not "Github": this is the string a reader matches against an
    // invoice.
    expect(seatPoolName("GITHUB_COPILOT_BUSINESS")).toBe(
      "GitHub Copilot Business",
    );
    expect(seatPoolName("COPILOT_STUDIO_PRO")).toBe("Copilot Studio Pro");
  });

  it("turns an unknown SKU into words rather than leaving a database key", () => {
    // The normal case. Providers invent SKUs faster than anyone maintains a
    // table of them, so the fallback carries most of the traffic.
    expect(seatPoolName("SOME_NEW_ASSISTANT_TIER")).toBe(
      "Some New Assistant Tier",
    );
  });

  it("leaves an initialism upper case instead of title-casing it", () => {
    // "Usl" reads as a misspelling; "USL" reads as the licence type it is.
    expect(seatPoolName("VIRTUAL_AGENT_USL")).toBe("Virtual Agent USL");
    expect(seatPoolName("PARTNER_API_SEATS")).toBe("Partner API Seats");
  });

  it("leaves a fragment carrying digits exactly as the provider wrote it", () => {
    expect(seatPoolName("MICROSOFT_365_COPILOT")).toBe("Microsoft 365 Copilot");
    expect(seatPoolName("TIER_2_AGENTS")).toBe("Tier 2 Agents");
  });

  it("falls back to the raw key rather than showing a pool with no name", () => {
    // An unnamed row cannot be told from the one below it, which is worse
    // than showing the key.
    expect(seatPoolName("___")).toBe("___");
    expect(seatPoolName("")).toBe("");
  });
});
