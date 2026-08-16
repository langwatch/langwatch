import { describe, expect, it } from "vitest";

import {
  decodeDeliveryCursor,
  encodeDeliveryCursor,
  InvalidWebhookDeliveryCursorError,
} from "../webhookEndpoint.service";

/**
 * The cursor is opaque to callers but it is still attacker-controlled input:
 * whatever `decodeDeliveryCursor` lets through becomes a bound on the delivery
 * query. Anything it does not recognise has to become the documented 422, not
 * a `NaN` bound the query layer discovers later.
 */
describe("Feature: webhook delivery cursor", () => {
  describe("given a cursor this API minted", () => {
    it("round-trips the timestamp and id", () => {
      const firedAt = new Date("2026-08-13T12:00:00.000Z");

      expect(
        decodeDeliveryCursor(encodeDeliveryCursor({ firedAt, id: "d_1" })),
      ).toEqual({ firedAt, id: "d_1" });
    });
  });

  describe("given no cursor at all", () => {
    it("reads as the first page rather than a refusal", () => {
      expect(decodeDeliveryCursor(undefined)).toBeUndefined();
    });
  });

  describe("given a cursor this API did not mint", () => {
    /**
     * `Number` accepts far more spellings than the encoder emits. Each of
     * these parses to a usable number, so only the canonical-form check
     * rejects them.
     */
    it.each([
      "  12~d_1",
      "1e3~d_1",
      "0x10~d_1",
      "+12~d_1",
      "12.0~d_1",
    ])("refuses the non-canonical timestamp %j", (encoded) => {
      expect(() => decodeDeliveryCursor(encoded)).toThrow(
        InvalidWebhookDeliveryCursorError,
      );
    });

    /**
     * The regression this pins: `8640000000000001` is an integer and passed
     * every check, then `new Date` turned it into an Invalid Date that
     * reached the query as a NaN bound instead of a 422.
     */
    it("refuses an integer beyond the representable date range", () => {
      expect(() => decodeDeliveryCursor("8640000000000001~d_1")).toThrow(
        InvalidWebhookDeliveryCursorError,
      );
    });

    it("refuses extra separator segments", () => {
      expect(() => decodeDeliveryCursor("12~d_1~extra")).toThrow(
        InvalidWebhookDeliveryCursorError,
      );
    });

    it.each([
      "",
      "12",
      "~d_1",
      "12~",
      "notanumber~d_1",
    ])("refuses the malformed cursor %j", (encoded) => {
      expect(() => decodeDeliveryCursor(encoded)).toThrow(
        InvalidWebhookDeliveryCursorError,
      );
    });
  });
});
