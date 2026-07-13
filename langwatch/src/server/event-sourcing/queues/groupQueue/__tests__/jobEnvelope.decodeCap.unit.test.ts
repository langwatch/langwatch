import { gzipSync, zstdCompressSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { MAX_BLOB_BYTES } from "../blobConstants";
import { decompress } from "../bodyCodec";
import { decodeJobEnvelope, PayloadTooLargeError } from "../jobEnvelope";

/**
 * Decode-side twin of the encode cap (ADR-030 §1): values staged before the
 * encode cap existed, or via the legacy bare-JSON path, must not reach
 * JSON.parse unbounded (specs/event-sourcing/poison-group-park-guard.feature).
 */
describe("decodeJobEnvelope decode cap", () => {
  describe("given a legacy bare value over the cap", () => {
    /** @scenario an oversized staged value is parked without being parsed */
    it("throws PayloadTooLargeError before parsing", async () => {
      const oversized = JSON.stringify({
        value: "x".repeat(MAX_BLOB_BYTES + 1024),
      });

      await expect(decodeJobEnvelope({ value: oversized })).rejects.toThrow(
        PayloadTooLargeError,
      );
    });
  });

  describe("given a legacy bare value under the cap", () => {
    it("decodes as before", async () => {
      const value = JSON.stringify({ id: "job-1", value: "small" });

      await expect(decodeJobEnvelope({ value })).resolves.toEqual({
        id: "job-1",
        value: "small",
      });
    });
  });

  describe("given an inline raw envelope whose body is over the cap", () => {
    /** @scenario an oversized staged value is parked without being parsed */
    it("throws PayloadTooLargeError before parsing", async () => {
      const body = JSON.stringify({ value: "x".repeat(MAX_BLOB_BYTES + 1024) });
      const header = JSON.stringify({ v: 1, e: "j" });
      const envelope = `GQ1|${header.length}|${header}${body}`;

      await expect(decodeJobEnvelope({ value: envelope })).rejects.toThrow(
        PayloadTooLargeError,
      );
    });
  });

  describe("given a gzip envelope that would inflate past the cap", () => {
    /** @scenario a compressed staged value that would decompress past the cap is parked */
    it("stops decompression at the bound and throws PayloadTooLargeError", async () => {
      // ~57 MB of JSON compresses to well under 1 MB - the zip-bomb shape a
      // pre-cap writer (or a tampered blob) could have staged.
      const body = JSON.stringify({ value: "0".repeat(MAX_BLOB_BYTES + 1024) });
      const compressed = gzipSync(body).toString("base64");
      const header = JSON.stringify({ v: 1, e: "gz" });
      const envelope = `GQ1|${header.length}|${header}${compressed}`;

      await expect(decodeJobEnvelope({ value: envelope })).rejects.toThrow(
        PayloadTooLargeError,
      );
    });
  });

  describe("given a zstd blob that would decompress past the cap", () => {
    /** @scenario a compressed staged value that would decompress past the cap is parked */
    it("throws the over-limit shape boundedDecompress converts to a park", async () => {
      // Pins the zstd over-cap error contract: jobEnvelope's boundedDecompress
      // catches code ERR_BUFFER_TOO_LARGE (or a RangeError naming the output
      // length) and converts it to PayloadTooLargeError → park. zstd blobs only
      // flow through the tiered/blob path (never the inline `e` header), so the
      // contract is pinned here at the codec seam; a Node version changing the
      // error shape fails this test instead of silently dropping zstd bombs to
      // replay.
      const bomb = zstdCompressSync(
        Buffer.from(JSON.stringify({ value: "0".repeat(MAX_BLOB_BYTES + 1024) })),
      );

      const error = await decompress(bomb).then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).not.toBeNull();
      const code = (error as NodeJS.ErrnoException).code;
      const isCaughtShape =
        code === "ERR_BUFFER_TOO_LARGE" ||
        (error instanceof RangeError && /output length/i.test(error.message));
      expect(isCaughtShape).toBe(true);
    });
  });

  describe("given a gzip envelope under the cap", () => {
    it("decodes as before", async () => {
      const body = JSON.stringify({ id: "job-1", value: "z".repeat(64) });
      const compressed = gzipSync(body).toString("base64");
      const header = JSON.stringify({ v: 1, e: "gz" });
      const envelope = `GQ1|${header.length}|${header}${compressed}`;

      await expect(decodeJobEnvelope({ value: envelope })).resolves.toEqual({
        id: "job-1",
        value: "z".repeat(64),
      });
    });
  });
});
