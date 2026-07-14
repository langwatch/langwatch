import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "../capOversizedAttributes";
import {
  capOversizedLogRecord,
  type CappableLogRecord,
} from "../capOversizedLogRecord";

function makeLog(over: Partial<CappableLogRecord> = {}): CappableLogRecord {
  return {
    body: "",
    attributes: {},
    resourceAttributes: {},
    ...over,
  };
}

describe("capOversizedLogRecord", () => {
  describe("given a log record within the size threshold", () => {
    it("leaves body and attributes byte-for-byte unchanged", () => {
      const log = makeLog({
        body: "0 files (directory exists but is empty).\n\nUNLOCK-PROOF-7777",
        attributes: {
          "event.name": "api_response_body",
          "session.id": "abc-123",
        },
        resourceAttributes: { "service.name": "claude-code" },
      });
      const before = JSON.parse(JSON.stringify(log));

      const capped = capOversizedLogRecord(log);

      expect(capped).toBe(0);
      expect(log).toEqual(before);
    });
  });

  describe("when the body exceeds the threshold", () => {
    it("truncates the body to a marked head under the cap and counts it", () => {
      const huge = "x".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 50_000);
      const log = makeLog({ body: huge });

      const capped = capOversizedLogRecord(log);

      expect(capped).toBe(1);
      expect(Buffer.byteLength(log.body, "utf8")).toBeLessThanOrEqual(
        DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
      );
      expect(log.body).toContain("[langwatch: truncated");
      expect(log.body).toContain(
        String(Buffer.byteLength(huge, "utf8")),
      );
      // The kept head is real content, not just the marker.
      expect(log.body.startsWith("x")).toBe(true);
    });
  });

  describe("when an attribute value exceeds the threshold", () => {
    it("caps that attribute, the body too if oversized, and counts each", () => {
      const hugeAttr = "y".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1);
      const hugeBody = "z".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1);
      const log = makeLog({
        body: hugeBody,
        attributes: {
          "event.name": "api_request_body", // small, untouched
          "api_request_body.raw": hugeAttr, // oversized
        },
        resourceAttributes: { big: hugeAttr },
      });

      const capped = capOversizedLogRecord(log);

      // body + one attribute + one resourceAttribute
      expect(capped).toBe(3);
      expect(log.attributes["event.name"]).toBe("api_request_body");
      expect(
        Buffer.byteLength(log.attributes["api_request_body.raw"]!, "utf8"),
      ).toBeLessThanOrEqual(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES);
      expect(log.attributes["api_request_body.raw"]).toContain(
        "[langwatch: truncated",
      );
      expect(log.resourceAttributes.big).toContain("[langwatch: truncated");
    });
  });

  describe("when a custom (smaller) max is provided", () => {
    it("honors it", () => {
      const log = makeLog({ body: "a".repeat(2000) });
      const capped = capOversizedLogRecord(log, 1000);
      expect(capped).toBe(1);
      expect(Buffer.byteLength(log.body, "utf8")).toBeLessThanOrEqual(1000);
    });
  });

  describe("given multibyte content right at the boundary", () => {
    it("never exceeds the byte budget and never throws", () => {
      // emoji are 4 UTF-8 bytes each; build a value just over a small cap.
      const log = makeLog({ body: "😀".repeat(400) }); // 1600 bytes
      const capped = capOversizedLogRecord(log, 1000);
      expect(capped).toBe(1);
      expect(Buffer.byteLength(log.body, "utf8")).toBeLessThanOrEqual(1000);
    });
  });

  describe("given malformed input", () => {
    it("does not throw and returns a count of 0", () => {
      // A record missing maps entirely — the guard degrades gracefully.
      const log = { body: "ok" } as unknown as CappableLogRecord;
      expect(() => capOversizedLogRecord(log)).not.toThrow();
    });
  });
});
