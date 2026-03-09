/**
 * Unit tests for invoice display helper functions.
 *
 * Tests the pure functions extracted from InvoicesBlock:
 * - getInvoiceStatusColor: maps Stripe invoice status to Chakra color palette
 * - formatInvoiceDate: formats unix timestamps to readable dates
 * - formatInvoiceAmount: formats cents to currency strings
 */
import { describe, expect, it } from "vitest";
import {
  getInvoiceStatusColor,
  formatInvoiceDate,
  formatInvoiceAmount,
} from "../invoice-utils";

describe("getInvoiceStatusColor", () => {
  describe("when status is paid", () => {
    it("returns green", () => {
      expect(getInvoiceStatusColor("paid")).toBe("green");
    });
  });

  describe("when status is open", () => {
    it("returns yellow", () => {
      expect(getInvoiceStatusColor("open")).toBe("yellow");
    });
  });

  describe("when status is void", () => {
    it("returns red", () => {
      expect(getInvoiceStatusColor("void")).toBe("red");
    });
  });

  describe("when status is uncollectible", () => {
    it("returns red", () => {
      expect(getInvoiceStatusColor("uncollectible")).toBe("red");
    });
  });

  describe("when status is unknown", () => {
    it("returns gray", () => {
      expect(getInvoiceStatusColor("something_else")).toBe("gray");
    });
  });
});

describe("formatInvoiceDate", () => {
  describe("when given a unix timestamp", () => {
    it("formats to en-US date string", () => {
      // 1700000000 = Nov 14, 2023
      expect(formatInvoiceDate(1700000000)).toBe("Nov 14, 2023");
    });
  });
});

describe("formatInvoiceAmount", () => {
  describe("when given USD cents", () => {
    it("formats to dollar amount", () => {
      expect(formatInvoiceAmount({ amountCents: 5000, currency: "usd" })).toBe(
        "$50.00",
      );
    });
  });

  describe("when given EUR cents", () => {
    it("formats to euro amount", () => {
      const result = formatInvoiceAmount({
        amountCents: 2900,
        currency: "eur",
      });
      expect(result).toContain("29.00");
    });
  });

  describe("when given zero amount", () => {
    it("formats to zero", () => {
      expect(formatInvoiceAmount({ amountCents: 0, currency: "usd" })).toBe(
        "$0.00",
      );
    });
  });
});
