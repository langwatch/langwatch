// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Money } from "../src/components/values/money.tsx";
import { formatCurrency } from "../src/format-currency.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

const en = (amount: number, currency = "USD", rest: object = {}) =>
  formatCurrency({ amount, currency, locale: "en-US", ...rest });

describe("formatCurrency", () => {
  describe("given each currency's own decimals", () => {
    /** @scenario "Money keeps each currency's own decimals" */
    it("shows none for yen, two for dollars and three for dinar", () => {
      expect(en(1234.5678, "JPY")).toBe("¥1,235");
      expect(en(1234.5678, "USD")).toBe("$1,234.57");
      expect(en(1234.5678, "KWD")).toBe("KWD\u00a01,234.568");
    });
  });

  describe("given a fraction of a cent", () => {
    /** @scenario "A fraction of a cent never reads as zero" */
    it("keeps two significant digits instead of rounding to zero", () => {
      expect(en(0.00042)).toBe("$0.00042");
      expect(en(0.5)).toBe("$0.50");
    });
  });

  describe("given an amount too small to show", () => {
    it("reads as below the floor, never $0.00", () => {
      expect(en(0.0000000003)).toBe("< $0.000001");
      expect(en(-0.0000000003)).toBe("> -$0.000001");
    });
  });

  describe("given zero", () => {
    it("shows the currency's decimals", () => {
      expect(en(0)).toBe("$0.00");
    });
  });

  describe("given another locale", () => {
    it("moves the separators and the symbol", () => {
      expect(formatCurrency({ amount: 1234.5, currency: "EUR", locale: "de-DE" })).toBe(
        "1.234,50 €",
      );
    });
  });

  describe("given the compact and fixed precisions", () => {
    it("shortens or fixes the decimals", () => {
      expect(en(1234567, "USD", { precision: "compact" })).toBe("$1.2M");
      expect(en(19.999, "USD", { precision: 0 })).toBe("$20");
    });
  });
});

describe("Money", () => {
  describe("given a signed tone", () => {
    it("puts a plus on a gain and names the whole figure for assistive tech", () => {
      renderWithDesignSystem(
        <Money amount={12.5} currency="USD" locale="en-US" tone="signed" data-testid="m" />,
      );

      expect(screen.getByTestId("m").getAttribute("aria-label")).toBe("+$12.50");
      expect(screen.getByTestId("m").textContent).toBe("+$12.50");
    });
  });
});
