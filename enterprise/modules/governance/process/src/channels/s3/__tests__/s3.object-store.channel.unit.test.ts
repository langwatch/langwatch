// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryObjectStoreChannel } from "../../memory/memory.object-store.channel.ts";
import { S3ObjectStoreChannel } from "../s3.object-store.channel.ts";

const credentials = { accessKeyId: "AKIA-test", secretAccessKey: "secret" };

describe("S3ObjectStoreChannel", () => {
  describe("given a source endpoint on the cloud metadata address", () => {
    it("refuses before any request leaves the process", async () => {
      await expect(
        S3ObjectStoreChannel.create().list({
          bucket: "logs",
          prefix: "",
          region: "us-east-1",
          endpoint: "http://169.254.169.254",
          credentials,
          limit: 10,
        }),
      ).rejects.toThrow(/cloud metadata/);
    });
  });

  describe("given an S3-compatible endpoint", () => {
    afterEach(() => vi.restoreAllMocks());

    /** @scenario "Every S3 client picks its region by the same rule" */
    it("signs with the named region, else 'auto'", async () => {
      const regions: string[] = [];
      vi.spyOn(S3Client.prototype, "send").mockImplementation(async function (this: S3Client) {
        regions.push(await this.config.region());
        return { Contents: [], IsTruncated: false };
      });
      for (const region of ["", "eu-central-1"]) {
        await S3ObjectStoreChannel.create().list({
          bucket: "logs",
          prefix: "",
          region,
          endpoint: "https://1.1.1.1:9000",
          credentials,
          limit: 10,
        });
      }
      expect(regions).toEqual(["auto", "eu-central-1"]);
    });
  });

  describe("given a read from the cloud metadata address", () => {
    it("refuses the read", async () => {
      await expect(
        S3ObjectStoreChannel.create().readText({
          bucket: "logs",
          key: "a.jsonl",
          region: "us-east-1",
          endpoint: "http://169.254.169.254",
          credentials,
          maxBytes: 1_000,
        }),
      ).rejects.toThrow(/cloud metadata/);
    });
  });
});

describe("MemoryObjectStoreChannel", () => {
  describe("given seeded objects under a prefix", () => {
    it("lists them in key order after the cursor, truncated at the limit", async () => {
      const store = MemoryObjectStoreChannel.create();
      for (const key of ["in/c", "in/a", "in/b", "out/z"]) {
        store.seed({ bucket: "logs", key, text: key });
      }
      const listed = await store.list({
        bucket: "logs",
        prefix: "in/",
        region: "us-east-1",
        startAfter: "in/a",
        credentials,
        limit: 1,
      });
      expect(listed).toEqual({ keys: ["in/b"], isTruncated: true });
    });
  });

  describe("given an object larger than the read allows", () => {
    it("refuses to read it", async () => {
      const store = MemoryObjectStoreChannel.create();
      store.seed({ bucket: "logs", key: "big", text: "0123456789" });
      await expect(
        store.readText({
          bucket: "logs",
          key: "big",
          region: "us-east-1",
          credentials,
          maxBytes: 4,
        }),
      ).rejects.toThrow(/exceeds 4 bytes/);
    });
  });
});
