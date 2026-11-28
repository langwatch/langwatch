import type * as SmithyConfig from "@smithy/core/config";
import { describe, expect, it, vi } from "vitest";

import { s3RegionFor } from "../s3-region.ts";

// The machine names no region in its environment or profile, but its EC2 metadata says us-east-1.
vi.mock("@smithy/core/config", async (importOriginal) => {
  const actual = await importOriginal<typeof SmithyConfig>();
  return {
    ...actual,
    NODE_REGION_CONFIG_OPTIONS: {
      ...actual.NODE_REGION_CONFIG_OPTIONS,
      environmentVariableSelector: () => undefined,
      default: async () => "us-east-1",
    },
    NODE_REGION_CONFIG_FILE_OPTIONS: { ...actual.NODE_REGION_CONFIG_FILE_OPTIONS },
    loadConfig:
      (options: { default: () => Promise<string | undefined> | string | undefined }) => async () =>
        options.default(),
  };
});

describe("s3RegionFor() on a host whose metadata names another region", () => {
  /** @scenario "The stored-objects client finds an AWS bucket's region when none is set" */
  it("asks the bucket instead of taking the host's region", async () => {
    const askBucket = vi.fn(async () => ({ kind: "found" as const, region: "eu-west-1" }));

    const region = s3RegionFor({ bucket: "objects", askBucket });

    if (typeof region === "string") throw new Error("No region is named, so it is looked up.");
    await expect(region()).resolves.toBe("eu-west-1");
    expect(askBucket).toHaveBeenCalledTimes(1);
  });

  describe("when the bucket cannot be asked, as from a subnet with no route to AWS", () => {
    /** @scenario "The host's region is the last resort when the bucket cannot be asked" */
    it("falls back to the host's region, as releases before 3.24 did", async () => {
      const askBucket = vi.fn(async () => ({ kind: "unknown" as const }));

      const region = s3RegionFor({ bucket: "objects", askBucket });

      if (typeof region === "string") throw new Error("No region is named, so it is looked up.");
      await expect(region()).resolves.toBe("us-east-1");
    });
  });

  describe("when AWS says the bucket does not exist", () => {
    it("says so rather than guessing the host's region", async () => {
      const askBucket = vi.fn(async () => ({ kind: "missing" as const }));

      const region = s3RegionFor({ bucket: "objects", askBucket });

      if (typeof region === "string") throw new Error("No region is named, so it is looked up.");
      await expect(region()).rejects.toMatchObject({ code: "s3_bucket_not_found" });
    });
  });
});
