import { DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES, resolveRequestBound } from "@langwatch/plans";
import {
  DATASET_ATTACHMENT_PURPOSE_CEILING_BYTES,
  DATASET_ATTACHMENT_PURPOSE_DEFAULT_BYTES,
} from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import {
  DATASET_CEILING_LIMITS,
  DATASET_DEFAULT_LIMITS,
  DATASET_LIMIT_BOUND_KEYS,
  formatDatasetByteLimit,
  formatDatasetRowLimit,
} from "../dataset-limits.ts";

const MIB = 1024 * 1024;

describe("dataset limits", () => {
  describe("given the request bounds registry", () => {
    it("takes every default limit from its registry key", () => {
      for (const [name, key] of Object.entries(DATASET_LIMIT_BOUND_KEYS)) {
        expect(DATASET_DEFAULT_LIMITS[name as keyof typeof DATASET_DEFAULT_LIMITS]).toBe(
          resolveRequestBound(key, "FREE"),
        );
      }
    });

    it("never states a ceiling below the default", () => {
      for (const name of Object.keys(
        DATASET_LIMIT_BOUND_KEYS,
      ) as (keyof typeof DATASET_DEFAULT_LIMITS)[]) {
        expect(DATASET_CEILING_LIMITS[name]).toBeGreaterThanOrEqual(DATASET_DEFAULT_LIMITS[name]);
      }
    });
  });

  describe("given the stored-object purpose for dataset attachments", () => {
    it("accepts by default the same file size a dataset cell does", () => {
      expect(DATASET_ATTACHMENT_PURPOSE_DEFAULT_BYTES).toBe(DATASET_DEFAULT_LIMITS.attachmentBytes);
    });

    it("stops at the same ceiling an organization's limit can be raised to", () => {
      expect(DATASET_ATTACHMENT_PURPOSE_CEILING_BYTES).toBe(
        DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
      );
      expect(DATASET_CEILING_LIMITS.attachmentBytes).toBe(DATASET_ATTACHMENT_PURPOSE_CEILING_BYTES);
    });
  });

  describe("when a limit is written for a person", () => {
    it("rounds down to a plain unit, so a file of the quoted size fits", () => {
      expect(formatDatasetByteLimit(20 * MIB)).toBe("20 MB");
      expect(formatDatasetByteLimit(DATASET_DEFAULT_LIMITS.rowBytes)).toBe("267 MB");
      expect(formatDatasetByteLimit(1024 * MIB)).toBe("1 GB");
      expect(formatDatasetByteLimit(1536 * MIB)).toBe("1.5 GB");
      expect(formatDatasetByteLimit(2048)).toBe("2 KB");
      expect(formatDatasetByteLimit(12)).toBe("12 bytes");
    });

    it("writes a row count with a thousands separator", () => {
      expect(formatDatasetRowLimit(100_000)).toBe("100,000");
    });
  });
});
