/**
 * @vitest-environment node
 *
 * Unit tests for content-addressed URI minting and scheme extraction.
 */
import { describe, expect, it } from "vitest";
import { getUriScheme, mintFileUri, mintS3Uri } from "../uri";

describe("mintS3Uri", () => {
  describe("given a project id and sha256", () => {
    /** @scenario "Minted URI is content-addressed under projectId and sha256" */
    it("matches s3://<bucket>/<projectId>/<sha256>", () => {
      const uri = mintS3Uri({
        bucket: "my-bucket",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      });
      expect(uri).toBe("s3://my-bucket/proj-abc/deadbeef1234");
    });
  });

  describe("when called twice with identical inputs", () => {
    /** @scenario "Same content from the same project yields the same URI" */
    it("returns the identical URI", () => {
      const params = {
        bucket: "my-bucket",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      };
      expect(mintS3Uri(params)).toBe(mintS3Uri(params));
    });
  });
});

describe("mintFileUri", () => {
  describe("given a root projectId and sha256", () => {
    it("matches file:///<root>/<projectId>/<sha256>", () => {
      const uri = mintFileUri({
        root: "/var/lib/langwatch/objects",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      });
      expect(uri).toBe(
        "file:///var/lib/langwatch/objects/proj-abc/deadbeef1234",
      );
    });

    it("normalises a root without a leading slash", () => {
      const uri = mintFileUri({
        root: "var/lib/langwatch/objects",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      });
      expect(uri).toBe(
        "file:///var/lib/langwatch/objects/proj-abc/deadbeef1234",
      );
    });
  });

  describe("when called twice with identical inputs", () => {
    it("returns the identical URI", () => {
      const params = {
        root: "/var/lib/langwatch/objects",
        projectId: "proj-abc",
        sha256: "deadbeef1234",
      };
      expect(mintFileUri(params)).toBe(mintFileUri(params));
    });
  });
});

describe("getUriScheme", () => {
  describe("given an s3 URI", () => {
    it("returns 's3'", () => {
      expect(getUriScheme("s3://my-bucket/proj/sha")).toBe("s3");
    });
  });

  describe("given a file URI", () => {
    it("returns 'file'", () => {
      expect(getUriScheme("file:///var/lib/objects/proj/sha")).toBe("file");
    });
  });

  describe("given an unknown scheme", () => {
    it("throws on an unrecognised scheme", () => {
      expect(() => getUriScheme("gs://bucket/object")).toThrow(
        /Unrecognised URI scheme/,
      );
    });

    it("throws when there is no colon", () => {
      expect(() => getUriScheme("notauri")).toThrow(
        /Unrecognised URI scheme/,
      );
    });
  });
});
