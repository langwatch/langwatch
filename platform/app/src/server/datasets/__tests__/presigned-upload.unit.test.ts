import { describe, expect, it } from "vitest";
import {
  exceedsUploadCap,
  stagingUploadKey,
  UPLOAD_MAX_BYTES,
} from "../presigned-upload";

describe("stagingUploadKey()", () => {
  describe("given valid ids", () => {
    it("returns a tenant-scoped staging key", () => {
      expect(stagingUploadKey("proj1", "abc123")).toBe("staging/proj1/abc123");
    });
  });

  describe("when the projectId contains a traversal sequence", () => {
    it("throws", () => {
      expect(() => stagingUploadKey("../evil", "abc")).toThrow(/traversal/);
    });
  });

  describe("when the uploadId contains a slash", () => {
    it("throws", () => {
      expect(() => stagingUploadKey("proj1", "a/b")).toThrow(/traversal/);
    });
  });
});

describe("exceedsUploadCap()", () => {
  describe("when the size is over the cap", () => {
    it("is true", () => {
      expect(exceedsUploadCap(UPLOAD_MAX_BYTES + 1)).toBe(true);
    });
  });

  describe("when the size is exactly at the cap", () => {
    it("is false", () => {
      expect(exceedsUploadCap(UPLOAD_MAX_BYTES)).toBe(false);
    });
  });

  describe("when the size is under the cap", () => {
    it("is false", () => {
      expect(exceedsUploadCap(1024)).toBe(false);
    });
  });
});
