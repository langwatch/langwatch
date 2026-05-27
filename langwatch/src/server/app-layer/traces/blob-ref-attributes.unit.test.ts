import { describe, it, expect } from "vitest";
import {
  mergeBlobRefsIntoAttributes,
  extractBlobRefsFromAttributes,
  hasBlobRefs,
  BLOB_REF_ATTR_PREFIX,
} from "./blob-ref-attributes";
import type { TraceBlobRef } from "./blob-store.service";

const ref = (key: string): TraceBlobRef => ({
  key,
  size: 40000,
  sha256: "abc123",
  encoding: "utf-8",
});

describe("blob-ref-attributes", () => {
  describe("given previewed attributes and blob refs", () => {
    it("round-trips merge → extract back to the original split", () => {
      const attributes = {
        "langwatch.output": "preview…",
        "gen_ai.system": "openai",
      };
      const blobRefs = { "langwatch.output": ref("trace-blobs/p/t/s/langwatch.output") };

      const merged = mergeBlobRefsIntoAttributes(attributes, blobRefs);
      // ref now lives under the reserved prefix, preview untouched
      expect(merged[`${BLOB_REF_ATTR_PREFIX}langwatch.output`]).toBe(
        JSON.stringify(blobRefs["langwatch.output"]),
      );
      expect(merged["langwatch.output"]).toBe("preview…");

      const split = extractBlobRefsFromAttributes(merged);
      expect(split.attributes).toEqual(attributes); // reserved key stripped
      expect(split.blobRefs).toEqual(blobRefs);
    });
  });

  describe("given attributes with no refs", () => {
    it("extract returns them unchanged with empty refs", () => {
      const attributes = { a: "1", b: "2" };
      const split = extractBlobRefsFromAttributes(attributes);
      expect(split.attributes).toEqual(attributes);
      expect(split.blobRefs).toEqual({});
      expect(hasBlobRefs(attributes)).toBe(false);
    });
  });

  describe("given a malformed reserved ref value", () => {
    it("skips it without throwing and keeps the preview", () => {
      const attributes = {
        "langwatch.output": "preview…",
        [`${BLOB_REF_ATTR_PREFIX}langwatch.output`]: "{not valid json",
      };
      const split = extractBlobRefsFromAttributes(attributes);
      expect(split.blobRefs).toEqual({});
      expect(split.attributes["langwatch.output"]).toBe("preview…");
    });
  });

  describe("hasBlobRefs", () => {
    it("is true when a reserved ref key is present", () => {
      expect(
        hasBlobRefs({ [`${BLOB_REF_ATTR_PREFIX}x`]: "{}", y: "z" }),
      ).toBe(true);
    });
  });
});
