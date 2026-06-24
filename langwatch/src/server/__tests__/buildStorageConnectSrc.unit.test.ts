import { describe, expect, it } from "vitest";
import { buildStorageConnectSrc } from "../buildStorageConnectSrc";

describe("buildStorageConnectSrc", () => {
  describe("when an explicit S3_ENDPOINT is set (prod / R2 / MinIO)", () => {
    it("returns exactly that endpoint's origin", () => {
      expect(
        buildStorageConnectSrc({
          S3_ENDPOINT:
            "https://langwatch-storage-prod.s3.eu-central-1.amazonaws.com",
          S3_REGION: "eu-central-1",
        }),
      ).toEqual([
        "https://langwatch-storage-prod.s3.eu-central-1.amazonaws.com",
      ]);
    });

    it("drops any path/query, keeping only the origin", () => {
      expect(
        buildStorageConnectSrc({
          S3_ENDPOINT: "https://s3.example.com/bucket?x=1",
        }),
      ).toEqual(["https://s3.example.com"]);
    });
  });

  describe("when no endpoint is set but a region is (plain AWS / IRSA)", () => {
    it("allows both path-style and virtual-hosted AWS forms for the region", () => {
      expect(buildStorageConnectSrc({ S3_REGION: "us-east-1" })).toEqual([
        "https://s3.us-east-1.amazonaws.com",
        "https://*.s3.us-east-1.amazonaws.com",
      ]);
    });
  });

  describe("when AWS is in use without endpoint or region (bucket/AWS_REGION only)", () => {
    it("derives the region from AWS_REGION", () => {
      expect(buildStorageConnectSrc({ AWS_REGION: "us-west-2" })).toEqual([
        "https://s3.us-west-2.amazonaws.com",
        "https://*.s3.us-west-2.amazonaws.com",
      ]);
    });

    it("falls back to the broad AWS wildcard when only a bucket name is set", () => {
      expect(buildStorageConnectSrc({ S3_BUCKET_NAME: "my-bucket" })).toEqual([
        "https://*.amazonaws.com",
      ]);
    });
  });

  describe("when no storage env is set at all (local-FS deployment)", () => {
    it("emits no storage origin — nothing to allow", () => {
      expect(buildStorageConnectSrc({})).toEqual([]);
    });
  });

  describe("when only Azure is configured (no AWS env)", () => {
    it("emits ONLY the Azure origin — no gratuitous amazonaws wildcard", () => {
      expect(
        buildStorageConnectSrc({
          AZURE_BLOB_ENDPOINT: "https://acct.blob.core.windows.net",
        }),
      ).toEqual(["https://acct.blob.core.windows.net"]);
    });
  });

  describe("when both S3 and Azure are configured", () => {
    it("adds the Azure endpoint origin alongside the S3 origin", () => {
      expect(
        buildStorageConnectSrc({
          S3_ENDPOINT: "https://s3.eu-central-1.amazonaws.com",
          AZURE_BLOB_ENDPOINT: "https://acct.blob.core.windows.net",
        }),
      ).toEqual([
        "https://s3.eu-central-1.amazonaws.com",
        "https://acct.blob.core.windows.net",
      ]);
    });
  });

  describe("when S3_REGION carries an injected CSP directive (security)", () => {
    it("rejects the non-region value and falls back to the wildcard rather than injecting", () => {
      const result = buildStorageConnectSrc({
        S3_REGION: "us-east-1; frame-src *",
      });
      expect(result).toEqual(["https://*.amazonaws.com"]);
      expect(result.join(" ")).not.toContain(";");
      expect(result.join(" ")).not.toContain(" frame-src");
    });
  });

  describe("when the endpoint is an opaque-origin scheme (file://)", () => {
    it("rejects it instead of emitting the string 'null' into the CSP", () => {
      const result = buildStorageConnectSrc({
        S3_ENDPOINT: "file:///mnt/storage",
        S3_REGION: "eu-west-1",
      });
      expect(result).not.toContain("null");
      // Falls through to the region-derived AWS origins.
      expect(result).toEqual([
        "https://s3.eu-west-1.amazonaws.com",
        "https://*.s3.eu-west-1.amazonaws.com",
      ]);
    });
  });

  describe("when the endpoint is malformed", () => {
    it("ignores it and falls back rather than throwing", () => {
      expect(
        buildStorageConnectSrc({
          S3_ENDPOINT: "not a url",
          S3_REGION: "eu-west-1",
        }),
      ).toEqual([
        "https://s3.eu-west-1.amazonaws.com",
        "https://*.s3.eu-west-1.amazonaws.com",
      ]);
    });
  });
});
