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

  describe("when neither endpoint nor region is set", () => {
    it("falls back to a broad AWS S3 wildcard", () => {
      expect(buildStorageConnectSrc({})).toEqual(["https://*.amazonaws.com"]);
    });
  });

  describe("when Azure blob storage is configured", () => {
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
