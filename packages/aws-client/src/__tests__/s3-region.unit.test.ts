import { describe, expect, it } from "vitest";

import { defaultS3Host, isAwsS3Endpoint, s3RegionOf } from "../s3-region.ts";

describe("s3RegionOf()", () => {
  describe("when a region is named", () => {
    /** @scenario "Every S3 client picks its region by the same rule" */
    it("returns it, whatever the endpoint", () => {
      expect(s3RegionOf({ region: "eu-central-1", endpoint: "http://minio:9000" })).toBe(
        "eu-central-1",
      );
      expect(s3RegionOf({ region: " eu-north1 " })).toBe("eu-north1");
    });
  });

  describe("when the endpoint is not AWS and no region is named", () => {
    it("returns 'auto', the region an S3-compatible service signs with", () => {
      for (const endpoint of ["https://abc.r2.cloudflarestorage.com", "http://minio:9000"]) {
        expect(s3RegionOf({ endpoint })).toBe("auto");
      }
    });
  });

  describe("when the endpoint is a regional AWS host and no region is named", () => {
    /** @scenario "S3 client never sends the 'auto' region to AWS, even with access keys" */
    it("reads the region from the host, never 'auto'", () => {
      const cases: [string, string][] = [
        ["https://s3.eu-west-1.amazonaws.com", "eu-west-1"],
        ["s3.eu-west-1.amazonaws.com/", "eu-west-1"],
        ["https://s3-eu-west-1.amazonaws.com", "eu-west-1"],
        ["https://s3.dualstack.us-east-2.amazonaws.com", "us-east-2"],
        ["https://bucket.s3.ap-south-1.amazonaws.com:443", "ap-south-1"],
        ["https://s3.cn-north-1.amazonaws.com.cn", "cn-north-1"],
        ["https://s3-fips.dualstack.us-east-2.amazonaws.com", "us-east-2"],
        ["https://s3-fips.us-gov-west-1.amazonaws.com", "us-gov-west-1"],
        ["https://bucket.vpce-1a2b3c4d-5e6f.s3.us-east-1.vpce.amazonaws.com", "us-east-1"],
      ];
      for (const [endpoint, region] of cases) {
        expect(s3RegionOf({ endpoint })).toBe(region);
      }
    });
  });

  describe("when the region is 'auto'", () => {
    /** @scenario "S3 client never sends the 'auto' region to AWS, even with access keys" */
    it("treats it as unnamed for AWS and keeps it for other services", () => {
      expect(s3RegionOf({ region: "auto", endpoint: "https://s3.eu-west-1.amazonaws.com" })).toBe(
        "eu-west-1",
      );
      expect(s3RegionOf({ region: " AUTO " })).toBeUndefined();
      expect(s3RegionOf({ region: "auto", endpoint: "http://minio:9000" })).toBe("auto");
    });
  });

  describe("when there is no regional endpoint and no region is named", () => {
    it("leaves the region to the SDK chain (AWS_REGION)", () => {
      expect(s3RegionOf({})).toBeUndefined();
      expect(s3RegionOf({ endpoint: "  ", region: "" })).toBeUndefined();
      expect(s3RegionOf({ endpoint: "https://s3.amazonaws.com" })).toBeUndefined();
    });
  });
});

describe("isAwsS3Endpoint()", () => {
  it("reads the hostname, so a path, port or missing scheme still counts", () => {
    expect(isAwsS3Endpoint("s3.eu-west-1.amazonaws.com/")).toBe(true);
    expect(isAwsS3Endpoint("https://s3.amazonaws.com:443/x")).toBe(true);
    expect(isAwsS3Endpoint("https://s3.cn-north-1.amazonaws.com.cn")).toBe(true);
    expect(isAwsS3Endpoint("https://amazonaws.com.evil.example")).toBe(false);
    expect(isAwsS3Endpoint("http://minio:9000")).toBe(false);
    expect(isAwsS3Endpoint("::not a url::")).toBe(false);
  });
});

describe("defaultS3Host()", () => {
  it("names the regional host, the China partition, or the global host", () => {
    expect(defaultS3Host("eu-west-1")).toBe("s3.eu-west-1.amazonaws.com");
    expect(defaultS3Host("cn-north-1")).toBe("s3.cn-north-1.amazonaws.com.cn");
    expect(defaultS3Host(undefined)).toBe("s3.amazonaws.com");
    expect(defaultS3Host("auto")).toBe("s3.amazonaws.com");
  });
});
