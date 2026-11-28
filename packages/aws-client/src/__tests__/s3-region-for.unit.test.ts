import { describe, expect, it, vi } from "vitest";

import { s3RegionFor, type S3BucketRegionAnswer } from "../s3-region.ts";

const unset = async (): Promise<string | undefined> => undefined;

function asking(answers: S3BucketRegionAnswer[]) {
  const ask = vi.fn(async () => answers.shift() ?? { kind: "unknown" as const });
  return ask;
}

async function resolve(region: ReturnType<typeof s3RegionFor>): Promise<string> {
  return typeof region === "string" ? region : region();
}

describe("s3RegionFor()", () => {
  describe("when the rule already names a region", () => {
    it("returns it as a plain string and never asks the bucket", () => {
      const askBucket = asking([]);

      expect(
        s3RegionFor({ region: "eu-central-1", bucket: "objects", askBucket, configured: unset }),
      ).toBe("eu-central-1");
      expect(s3RegionFor({ endpoint: "http://minio:9000", bucket: "objects", askBucket })).toBe(
        "auto",
      );
      expect(askBucket).not.toHaveBeenCalled();
    });
  });

  describe("when AWS_REGION or the profile names a region", () => {
    /** @scenario "A region set in the environment or profile is used without asking the bucket" */
    it("uses it and sends no question to AWS", async () => {
      const askBucket = asking([{ kind: "found", region: "eu-west-1" }]);

      const region = s3RegionFor({
        bucket: "objects",
        askBucket,
        configured: async () => "eu-west-2",
      });

      await expect(resolve(region)).resolves.toBe("eu-west-2");
      expect(askBucket).not.toHaveBeenCalled();
    });
  });

  describe("when nothing names a region", () => {
    /** @scenario "The stored-objects client finds an AWS bucket's region when none is set" */
    it("asks the bucket once and keeps its answer", async () => {
      const askBucket = asking([{ kind: "found", region: "eu-west-1" }]);
      const region = s3RegionFor({ bucket: "objects", askBucket, configured: unset });

      await expect(resolve(region)).resolves.toBe("eu-west-1");
      await expect(resolve(region)).resolves.toBe("eu-west-1");
      expect(askBucket).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Concurrent first calls share one region lookup" */
    it("shares one lookup between calls that start together", async () => {
      const askBucket = asking([{ kind: "found", region: "ap-south-1" }]);
      const region = s3RegionFor({ bucket: "objects", askBucket, configured: unset });

      const regions = await Promise.all([1, 2, 3, 4].map(() => resolve(region)));

      expect(regions).toEqual(["ap-south-1", "ap-south-1", "ap-south-1", "ap-south-1"]);
      expect(askBucket).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the bucket cannot be asked but the host names a region", () => {
    /** @scenario "The host's region stands in only until the bucket answers" */
    it("uses the host's region for a pause, then asks the bucket again and keeps its answer", async () => {
      let now = 0;
      const askBucket = asking([{ kind: "unknown" }, { kind: "found", region: "eu-west-1" }]);
      const region = s3RegionFor({
        bucket: "objects",
        askBucket,
        configured: unset,
        hostRegion: async () => "us-east-1",
        now: () => now,
      });

      await expect(resolve(region)).resolves.toBe("us-east-1");
      now += 1_000;
      await expect(resolve(region)).resolves.toBe("us-east-1");
      expect(askBucket).toHaveBeenCalledTimes(1);

      now += 60_000;
      await expect(resolve(region)).resolves.toBe("eu-west-1");
      now += 60_000;
      await expect(resolve(region)).resolves.toBe("eu-west-1");
      expect(askBucket).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the bucket's region cannot be found", () => {
    /** @scenario "A region that cannot be found names the setting that fixes it" */
    it("fails naming S3_REGION and the Helm value, then asks again after a pause", async () => {
      let now = 0;
      const askBucket = asking([{ kind: "unknown" }, { kind: "found", region: "eu-west-1" }]);
      const region = s3RegionFor({
        bucket: "objects",
        askBucket,
        configured: unset,
        hostRegion: unset,
        now: () => now,
      });

      await expect(resolve(region)).rejects.toMatchObject({
        code: "s3_region_not_found",
        message: expect.stringMatching(/S3_REGION.*app\.dataplane\.providers\.awsS3\.region/),
      });
      now += 1_000;
      await expect(resolve(region)).rejects.toMatchObject({ code: "s3_region_not_found" });
      expect(askBucket).toHaveBeenCalledTimes(1);

      now += 60_000;
      await expect(resolve(region)).resolves.toBe("eu-west-1");
      expect(askBucket).toHaveBeenCalledTimes(2);
    });

    it("treats a failed question as not found, keeping why it failed", async () => {
      const timeout = new Error("connect ETIMEDOUT");
      const askBucket = vi.fn(async (): Promise<S3BucketRegionAnswer> => {
        throw timeout;
      });
      const region = s3RegionFor({
        bucket: "objects",
        askBucket,
        configured: unset,
        hostRegion: unset,
      });

      await expect(resolve(region)).rejects.toMatchObject({
        code: "s3_region_not_found",
        cause: timeout,
      });
    });

    it("keeps the refusal AWS answered with", async () => {
      const refusal = new Error("Forbidden");
      const askBucket = asking([{ kind: "unknown", cause: refusal }]);
      const region = s3RegionFor({
        bucket: "objects",
        askBucket,
        configured: unset,
        hostRegion: unset,
      });

      await expect(resolve(region)).rejects.toMatchObject({ cause: refusal });
    });
  });

  describe("when the bucket does not exist", () => {
    /** @scenario "A bucket that does not exist is named, not blamed on the region" */
    it("says so instead of asking for a region", async () => {
      const askBucket = asking([{ kind: "missing" }]);
      const region = s3RegionFor({ bucket: "objects", askBucket, configured: unset });

      await expect(resolve(region)).rejects.toMatchObject({
        code: "s3_bucket_not_found",
        message: expect.stringMatching(/"objects".*S3_BUCKET_NAME.*GovCloud or China.*S3_REGION/),
      });
    });
  });
});
