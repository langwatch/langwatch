import { describe, expect, it } from "vitest";
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  isRefusedAttachmentMediaType,
  normalizeAttachmentMediaType,
} from "~/shared/datasets/attachment-policy";
import {
  assertDatasetAttachmentMediaTypeAllowed,
  assertDatasetAttachmentWithinLimit,
} from "../attachments";

describe("dataset attachment upload policy", () => {
  describe("given a file larger than the upload limit", () => {
    /** @scenario "A file over the size limit is refused with a clear error" */
    it("refuses it and names the largest size accepted", () => {
      try {
        assertDatasetAttachmentWithinLimit(DATASET_ATTACHMENT_MAX_BYTES + 1);
        expect.unreachable("the oversized file was accepted");
      } catch (error) {
        const handled = error as {
          code: string;
          meta: Record<string, unknown>;
        };
        expect(handled.code).toBe("dataset_attachment_too_large");
        expect(handled.meta.maxBytes).toBe(DATASET_ATTACHMENT_MAX_BYTES);
      }
    });
  });

  describe("given a file of exactly the upload limit", () => {
    it("accepts it", () => {
      expect(() =>
        assertDatasetAttachmentWithinLimit(DATASET_ATTACHMENT_MAX_BYTES),
      ).not.toThrow();
    });
  });

  describe("given a media type a browser can run", () => {
    it.each([
      "text/html",
      "application/xhtml+xml",
      "image/svg+xml",
      "application/javascript",
      "text/javascript",
    ])("refuses %s", (mediaType) => {
      expect(isRefusedAttachmentMediaType(mediaType)).toBe(true);
      try {
        assertDatasetAttachmentMediaTypeAllowed(mediaType);
        expect.unreachable("the refused media type was accepted");
      } catch (error) {
        expect((error as { code: string }).code).toBe(
          "dataset_attachment_type_refused",
        );
      }
    });

    it("refuses it whatever parameters and case it arrives in", () => {
      expect(isRefusedAttachmentMediaType("TEXT/HTML; charset=utf-8")).toBe(
        true,
      );
    });
  });

  describe("given a media type the product accepts", () => {
    it.each([
      "image/png",
      "application/pdf",
      "audio/mpeg",
      "text/csv",
      "application/octet-stream",
    ])("accepts %s", (mediaType) => {
      expect(isRefusedAttachmentMediaType(mediaType)).toBe(false);
      expect(() =>
        assertDatasetAttachmentMediaTypeAllowed(mediaType),
      ).not.toThrow();
    });
  });

  describe("given a part that declares no media type", () => {
    it("stores it as unnamed bytes", () => {
      expect(normalizeAttachmentMediaType("")).toBe("application/octet-stream");
      expect(normalizeAttachmentMediaType(undefined)).toBe(
        "application/octet-stream",
      );
    });

    it("drops the parameters a browser appends", () => {
      expect(normalizeAttachmentMediaType("text/csv; charset=utf-8")).toBe(
        "text/csv",
      );
    });
  });
});
