/**
 * @vitest-environment node
 *
 * Unit tests for StorageRegistry scheme-dispatch.
 */
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { StorageDriver } from "../storage-driver";
import { StorageRegistry } from "../storage-registry";

function makeMockDriver(): StorageDriver {
  return {
    get: vi.fn().mockResolvedValue(new Readable()),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  };
}

describe("StorageRegistry", () => {
  describe("when an s3 URI is passed", () => {
    /** @scenario "StorageDriver interface exposes get, put, delete, exists" */
    /** @scenario "Storage registry dispatches by URI scheme" */
    it("delegates to the s3 driver", async () => {
      const s3 = makeMockDriver();
      const file = makeMockDriver();
      const registry = new StorageRegistry({ s3, file });

      const uri = "s3://my-bucket/proj/sha256abc";

      await registry.get(uri);
      await registry.put(uri, Buffer.from("hello"), "application/octet-stream");
      await registry.delete(uri);
      await registry.exists(uri);

      expect(s3.get).toHaveBeenCalledWith(uri);
      expect(s3.put).toHaveBeenCalledWith(
        uri,
        expect.any(Buffer),
        "application/octet-stream",
      );
      expect(s3.delete).toHaveBeenCalledWith(uri);
      expect(s3.exists).toHaveBeenCalledWith(uri);

      expect(file.get).not.toHaveBeenCalled();
      expect(file.put).not.toHaveBeenCalled();
      expect(file.delete).not.toHaveBeenCalled();
      expect(file.exists).not.toHaveBeenCalled();
    });
  });

  describe("when a file URI is passed", () => {
    /** @scenario "Both drivers remain available for reads regardless of which scheme new URIs use" */
    it("delegates to the file driver", async () => {
      const s3 = makeMockDriver();
      const file = makeMockDriver();
      const registry = new StorageRegistry({ s3, file });

      const uri = "file:///var/lib/langwatch/objects/proj/sha256abc";

      await registry.get(uri);
      await registry.put(uri, Buffer.from("hello"), "application/octet-stream");
      await registry.delete(uri);
      await registry.exists(uri);

      expect(file.get).toHaveBeenCalledWith(uri);
      expect(file.put).toHaveBeenCalledWith(
        uri,
        expect.any(Buffer),
        "application/octet-stream",
      );
      expect(file.delete).toHaveBeenCalledWith(uri);
      expect(file.exists).toHaveBeenCalledWith(uri);

      expect(s3.get).not.toHaveBeenCalled();
      expect(s3.put).not.toHaveBeenCalled();
      expect(s3.delete).not.toHaveBeenCalled();
      expect(s3.exists).not.toHaveBeenCalled();
    });
  });
});
