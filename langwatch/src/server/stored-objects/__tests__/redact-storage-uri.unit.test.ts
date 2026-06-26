import { describe, expect, it } from "vitest";

import {
  redactStorageUri,
  redactStorageUrisInText,
} from "../project-storage-destination";

describe("redactStorageUri", () => {
  describe("given a gs:// uri", () => {
    it("redacts the bucket so a GCS BYOC bucket name doesn't leak", () => {
      expect(redactStorageUri("gs://customer-private/proj-abc/sha256")).toBe(
        "gs://***/proj-abc/sha256",
      );
    });
  });

  describe("given an uppercase scheme", () => {
    it("still redacts the bucket (URI schemes are case-insensitive)", () => {
      expect(redactStorageUri("S3://customer-private/proj-abc/sha256")).toBe(
        "S3://***/proj-abc/sha256",
      );
    });
  });
});

describe("redactStorageUrisInText", () => {
  describe("given an error message embedding a gs:// uri", () => {
    it("redacts the bucket out of the free text", () => {
      const msg =
        "failed to GET object at gs://customer-private/proj-abc/sha256: 404";
      expect(redactStorageUrisInText(msg)).toBe(
        "failed to GET object at gs://***/proj-abc/sha256: 404",
      );
    });
  });

  describe("given an error message embedding an uppercase S3:// uri", () => {
    it("redacts the bucket out of the free text", () => {
      const msg =
        "S3 SDK error: failed at S3://customer-private/proj-abc/sha256";
      expect(redactStorageUrisInText(msg)).toBe(
        "S3 SDK error: failed at S3://***/proj-abc/sha256",
      );
    });
  });
});
