// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

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
