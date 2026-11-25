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

describe("S3ObjectStoreChannel.readBytes", () => {
  afterEach(() => vi.restoreAllMocks());

  function serve({ chunks, contentLength }: { chunks: Uint8Array[]; contentLength?: number }) {
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
      ContentLength: contentLength,
      Body: (async function* () {
        yield* chunks;
      })(),
    }));
  }

  function read(maxBytes = 1024) {
    return S3ObjectStoreChannel.create().readBytes({
      bucket: "logs",
      key: "a.parquet",
      region: "us-east-1",
      credentials,
      maxBytes,
    });
  }

  const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];

  describe.each([
    ["a declared length", 5],
    ["no declared length", undefined],
  ])("given a body with %s", (_label, contentLength) => {
    it("returns the bytes in a buffer that owns its whole ArrayBuffer", async () => {
      serve({ chunks: parts, contentLength });

      const bytes = await read();

      expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
      expect(bytes.byteOffset).toBe(0);
      expect(bytes.buffer.byteLength).toBe(5);
    });
  });

  describe("given a declared length past the cap", () => {
    it("refuses before reading the body", async () => {
      let pulled = false;
      vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
        ContentLength: 4096,
        Body: (async function* () {
          pulled = true;
          yield new Uint8Array(4096);
        })(),
      }));

      await expect(read(1024)).rejects.toThrow(/exceeds 1024 bytes/);
      expect(pulled).toBe(false);
    });
  });

  describe("given a body longer than its declared length", () => {
    it("refuses it", async () => {
      serve({ chunks: parts, contentLength: 4 });

      await expect(read()).rejects.toThrow(/exceeds 4 bytes/);
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
