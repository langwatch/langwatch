import { describe, expect, it } from "vitest";

import {
  base64LengthOf,
  DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
  DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
  DATASET_DEFAULT_BOUNDS,
  DATASET_DERIVED_BOUND_KEYS,
  DATASET_INLINE_STRING_CEILING_BYTES,
  deriveDatasetBounds,
  effectiveDatasetAttachmentMaxBytes,
} from "../dataset-bounds.ts";
import { resolveRequestBound } from "../request-bounds.ts";

const MiB = 1024 * 1024;

describe("given the dataset bounds derivation", () => {
  describe("when no organization override is set", () => {
    /** @scenario "Every dataset size limit follows the per-file limit" */
    it("sizes a row for ten inline files of the per-file limit", () => {
      expect(DATASET_DEFAULT_BOUNDS.datasetAttachmentBytes).toBe(20 * MiB);
      expect(DATASET_DEFAULT_BOUNDS.datasetRowBytes).toBe(10 * base64LengthOf(20 * MiB) + MiB);
      expect(DATASET_DEFAULT_BOUNDS.datasetRowBytes).toBeGreaterThan(200 * MiB);
      expect(DATASET_DEFAULT_BOUNDS.datasetFileBytes).toBe(
        4 * DATASET_DEFAULT_BOUNDS.datasetRowBytes,
      );
      expect(DATASET_DEFAULT_BOUNDS.evaluationLogResultsBytes).toBe(
        DATASET_DEFAULT_BOUNDS.datasetRowBytes,
      );
      expect(DATASET_DEFAULT_BOUNDS.datasetWholeReadBytes).toBe(
        DATASET_DEFAULT_BOUNDS.datasetRowBytes,
      );
    });

    it("sizes one upload call for four full rows, about 1 GiB", () => {
      expect(DATASET_DEFAULT_BOUNDS.datasetFileBytes).toBe(
        4 * DATASET_DEFAULT_BOUNDS.datasetRowBytes,
      );
      expect(DATASET_DEFAULT_BOUNDS.datasetFileBytes).toBeGreaterThanOrEqual(1024 * MiB);
    });

    it("keeps a single .json array under the string ceiling", () => {
      expect(DATASET_DEFAULT_BOUNDS.datasetJsonFileBytes).toBe(DATASET_INLINE_STRING_CEILING_BYTES);
    });

    it("fits one full row in a logged batch and in a whole-dataset read", () => {
      expect(DATASET_DEFAULT_BOUNDS.evaluationLogResultsBytes).toBe(
        DATASET_DEFAULT_BOUNDS.datasetRowBytes,
      );
      expect(DATASET_DEFAULT_BOUNDS.datasetWholeReadBytes).toBe(
        DATASET_DEFAULT_BOUNDS.datasetRowBytes,
      );
    });

    it("fits one row holding one inline file in an inline read", () => {
      expect(DATASET_DEFAULT_BOUNDS.datasetInlineReadBytes).toBe(base64LengthOf(20 * MiB) + MiB);
    });

    it("quotes the same numbers in the request-bounds registry on every tier", () => {
      for (const key of DATASET_DERIVED_BOUND_KEYS) {
        for (const plan of ["FREE", "GROWTH", "ENTERPRISE"]) {
          expect(resolveRequestBound(key, plan)).toBe(DATASET_DEFAULT_BOUNDS[key]);
        }
      }
    });

    /** @scenario "Uploads accept one hundred thousand rows and six hundred attachment uploads a minute" */
    it("accepts 100,000 rows per upload and 600 attachment uploads a minute", () => {
      expect(resolveRequestBound("datasetRowsMax", "FREE")).toBe(100_000);
      expect(resolveRequestBound("datasetAttachmentUploadsPerMinute", "FREE")).toBe(600);
    });
  });

  describe("when an organization's per-file limit is raised", () => {
    /** @scenario "Raising the per-file limit raises every limit derived from it" */
    it("raises every derived bound with it", () => {
      const raised = deriveDatasetBounds(40 * MiB);

      expect(raised.datasetAttachmentBytes).toBe(40 * MiB);
      for (const key of DATASET_DERIVED_BOUND_KEYS) {
        expect(raised[key]).toBeGreaterThanOrEqual(DATASET_DEFAULT_BOUNDS[key]);
      }
      expect(raised.datasetInlineReadBytes).toBe(base64LengthOf(40 * MiB) + MiB);
    });

    it("never sizes an inline row past the string ceiling", () => {
      const raised = deriveDatasetBounds(DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES);

      expect(raised.datasetRowBytes).toBe(DATASET_INLINE_STRING_CEILING_BYTES);
      expect(raised.datasetInlineReadBytes).toBe(DATASET_INLINE_STRING_CEILING_BYTES);
    });
  });

  describe("when an override is resolved to the effective per-file limit", () => {
    it("answers the default when nothing is set", () => {
      expect(effectiveDatasetAttachmentMaxBytes(null)).toBe(DATASET_ATTACHMENT_DEFAULT_MAX_BYTES);
      expect(effectiveDatasetAttachmentMaxBytes(undefined)).toBe(
        DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
      );
    });

    it("never goes below the default or above the ceiling", () => {
      expect(effectiveDatasetAttachmentMaxBytes(1 * MiB)).toBe(
        DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
      );
      expect(effectiveDatasetAttachmentMaxBytes(50 * MiB)).toBe(50 * MiB);
      expect(effectiveDatasetAttachmentMaxBytes(10_000 * MiB)).toBe(
        DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
      );
    });
  });
});
