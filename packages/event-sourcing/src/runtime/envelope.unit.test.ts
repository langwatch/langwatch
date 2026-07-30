import { describe, expect, it } from "vitest";
import type { Job, JobHeader } from "./contracts";
import {
  decodeJob,
  encodeJob,
  MalformedEnvelopeError,
  readHeader,
  readSequence,
  withAttempt,
} from "./envelope";

/**
 * The envelope is a header segment in front of an opaque body (ADR-108
 * decision 6): reading the header must never depend on the body's size or
 * content, and a job's identity — everything but `attempt` — must survive
 * every retry unchanged.
 */

function header(overrides: Partial<JobHeader> = {}): JobHeader {
  return {
    tenantId: "tenant-1",
    lane: { kind: "fold", name: "traceSummary" },
    scopeParts: [],
    aggregateId: "trace-1",
    eventType: "trace/spanReceived",
    eventId: "evt-1",
    sequence: 1,
    attempt: 0,
    costBytes: 42,
    ...overrides,
  };
}

function job(overrides: Partial<JobHeader> = {}, body = '{"ok":true}'): Job {
  return { header: header(overrides), body };
}

describe("envelope", () => {
  describe("given the header segment in front of the body", () => {
    /** @scenario A job's sequence is readable without decoding its body */
    it("reads the sequence without touching the body", () => {
      const encoded = encodeJob(job({ sequence: 7 }));
      expect(readSequence(encoded)).toBe(7);
    });

    /** @scenario Reading a job's header costs nothing proportional to the body's size */
    it("reads the header off a huge, non-JSON body without ever parsing it", () => {
      // If reading the header touched the body at all, this would throw:
      // the body below is not valid JSON, and is not even well-formed text.
      const hugeGarbageBody = "x".repeat(4 * 1024 * 1024);
      const encoded = encodeJob(job({ sequence: 99 }, hugeGarbageBody));
      expect(readHeader(encoded).sequence).toBe(99);
      expect(readSequence(encoded)).toBe(99);
    });

    /** @scenario The header and body round-trip losslessly */
    it("round-trips a body containing separators and unicode byte-for-byte", () => {
      const body = "contains | a pipe, digits 12|34, and unicode: héllo 🎉";
      const decoded = decodeJob(encodeJob(job({}, body)));
      expect(decoded.body).toBe(body);
    });

    /** @scenario A body that stands in for a compressed, spool-offloaded payload round-trips unchanged */
    it("round-trips an offloaded body and its blob reference unchanged", () => {
      const offloaded = job(
        { blobRef: "tenant-1/blob-9" },
        "opaque-spool-placeholder",
      );
      const decoded = decodeJob(encodeJob(offloaded));
      expect(decoded.body).toBe(offloaded.body);
      expect(decoded.header.blobRef).toBe("tenant-1/blob-9");
    });
  });

  describe("given a job's identity", () => {
    /** @scenario A job's identity names the tenant, the lane, the aggregate and the event, and nothing else */
    it("names the tenant, lane, aggregate and event and carries no growing id", () => {
      const decoded = decodeJob(encodeJob(job()));
      expect(decoded.header).toEqual({
        tenantId: "tenant-1",
        lane: { kind: "fold", name: "traceSummary" },
        scopeParts: [],
        aggregateId: "trace-1",
        eventType: "trace/spanReceived",
        eventId: "evt-1",
        sequence: 1,
        attempt: 0,
        costBytes: 42,
      });
      // No field carries a segment count, a timestamp, or any other
      // accumulated marker — the header is exactly the declared shape.
      expect(Object.keys(decoded.header).sort()).toEqual(
        [
          "tenantId",
          "lane",
          "scopeParts",
          "aggregateId",
          "eventType",
          "eventId",
          "sequence",
          "attempt",
          "costBytes",
        ].sort(),
      );
    });

    /** @scenario A retried job presents the same sequence it was first staged with */
    it("keeps the first-staged sequence across a retry", () => {
      const first = job({ sequence: 12, attempt: 0 });
      const retried = withAttempt(first, 1);
      expect(retried.header.sequence).toBe(12);
    });

    /** @scenario A retried job's identity survives a decode round trip */
    it("keeps the sequence and aggregate id through a retry and a decode round trip", () => {
      const first = job({ sequence: 12, aggregateId: "trace-9", attempt: 0 });
      const retried = withAttempt(first, 3);
      const decoded = decodeJob(encodeJob(retried));
      expect(decoded.header.sequence).toBe(12);
      expect(decoded.header.aggregateId).toBe("trace-9");
    });

    /** @scenario Advancing a job's attempt leaves every other header field and the body untouched */
    it("changes only the attempt when advancing to the next attempt", () => {
      const original = job(
        { sequence: 5, aggregateId: "trace-3", eventId: "evt-3" },
        "payload-bytes",
      );
      const advanced = withAttempt(original, 4);
      expect(advanced.header).toEqual({ ...original.header, attempt: 4 });
      expect(advanced.body).toBe(original.body);
    });

    /** @scenario A job stays readable as its attempt count grows */
    it("stays readable as its attempt grows through several digit widths", () => {
      let current = job({ sequence: 1 });
      for (const attempt of [1, 9, 10, 99, 100, 999]) {
        current = withAttempt(current, attempt);
        const decoded = decodeJob(encodeJob(current));
        expect(decoded.header.attempt).toBe(attempt);
        expect(decoded.header.sequence).toBe(1);
      }
    });
  });

  describe("given there is one envelope format", () => {
    /** @scenario A malformed header is refused rather than guessed at */
    it("refuses a value with no header separator", () => {
      expect(() => decodeJob("not an envelope at all")).toThrow(
        MalformedEnvelopeError,
      );
    });

    it("refuses a value whose length prefix is not a number", () => {
      expect(() => decodeJob("abc|{}rest")).toThrow(MalformedEnvelopeError);
    });

    it("refuses a value whose header segment is not valid JSON", () => {
      expect(() => decodeJob("9|not-jsonrest")).toThrow(MalformedEnvelopeError);
    });
  });
});
