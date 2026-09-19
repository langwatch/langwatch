/**
 * `lw:render-receipt` arrives over a `MessagePort` the sandboxed frame's
 * author code can post on directly, bypassing the shim that normally
 * enforces the markup cap and field shapes. `sanitizeRenderReceipt` is the
 * parent's own re-validation of that untrusted payload.
 *
 * @see specs/analytics/dashboard-widget-render-receipt.feature
 */

import { describe, expect, it } from "vitest";

import { CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS } from "../bridgeProtocol";
import { sanitizeRenderReceipt } from "../frameBridge";

describe("given a raw lw:render-receipt payload", () => {
  describe("when it is well-formed", () => {
    it("passes it through unchanged", () => {
      const receipt = sanitizeRenderReceipt({
        status: "ok",
        markup: "<div />",
        isMarkupTruncated: false,
        height: 120,
      });

      expect(receipt).toEqual({
        status: "ok",
        markup: "<div />",
        isMarkupTruncated: false,
        height: 120,
      });
    });

    it("keeps an errorText string, clamped to 4,000 chars", () => {
      const oversized = "e".repeat(5_000);
      const receipt = sanitizeRenderReceipt({
        status: "error",
        markup: "",
        isMarkupTruncated: false,
        height: 0,
        errorText: oversized,
      });

      expect(receipt?.errorText).toHaveLength(4_000);
      expect(receipt?.errorText).toBe(oversized.slice(0, 4_000));
    });
  });

  describe("when markup exceeds the cap", () => {
    it("clamps markup and flags isMarkupTruncated regardless of the reported flag", () => {
      const oversized = "x".repeat(CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS + 500);
      const receipt = sanitizeRenderReceipt({
        status: "ok",
        markup: oversized,
        isMarkupTruncated: false,
        height: 10,
      });

      expect(receipt?.markup).toHaveLength(
        CHART_FRAME_RECEIPT_MAX_MARKUP_CHARS,
      );
      expect(receipt?.isMarkupTruncated).toBe(true);
    });
  });

  describe("when the frame itself reported isMarkupTruncated", () => {
    it("keeps isMarkupTruncated true even though markup fits under the cap", () => {
      const receipt = sanitizeRenderReceipt({
        status: "ok",
        markup: "<div />",
        isMarkupTruncated: true,
        height: 10,
      });

      expect(receipt?.isMarkupTruncated).toBe(true);
    });
  });

  describe("when height is missing, negative or non-finite", () => {
    it.each([
      undefined,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "240",
    ])("falls back to 0 for %p", (height) => {
      const receipt = sanitizeRenderReceipt({
        status: "ok",
        markup: "<div />",
        isMarkupTruncated: false,
        height,
      });

      expect(receipt?.height).toBe(0);
    });
  });

  describe("when status is not exactly ok or error", () => {
    it.each([
      "pending",
      "OK",
      "",
      null,
      undefined,
      1,
    ])("drops the message for status %p", (status) => {
      const receipt = sanitizeRenderReceipt({
        status,
        markup: "<div />",
        isMarkupTruncated: false,
        height: 10,
      });

      expect(receipt).toBeNull();
    });
  });

  describe("when markup is not a string", () => {
    it.each([
      undefined,
      null,
      42,
      { html: "<div />" },
    ])("drops the message for markup %p", (markup) => {
      const receipt = sanitizeRenderReceipt({
        status: "ok",
        markup,
        isMarkupTruncated: false,
        height: 10,
      });

      expect(receipt).toBeNull();
    });
  });

  describe("when the payload is not an object", () => {
    it.each([
      null,
      undefined,
      "lw:render-receipt",
      42,
      true,
    ])("drops the message for %p", (raw) => {
      expect(sanitizeRenderReceipt(raw)).toBeNull();
    });
  });
});
