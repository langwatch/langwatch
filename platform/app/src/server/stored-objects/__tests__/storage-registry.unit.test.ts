import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { StorageDriver } from "../storage-driver";
import { StorageRegistry } from "../storage-registry";

function makeDriver(): StorageDriver {
  return {
    get: vi.fn().mockResolvedValue(new Readable()),
    put: vi.fn().mockResolvedValue(void 0),
    delete: vi.fn().mockResolvedValue(void 0),
    exists: vi.fn().mockResolvedValue(true),
  };
}

describe("StorageRegistry", () => {
  it("dispatches every byte operation by the URI scheme", async () => {
    const s3 = makeDriver();
    const file = makeDriver();
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
  });

  it("does not construct Azure until an Azure URI needs it", async () => {
    const azure = makeDriver();
    const factory = vi.fn(() => azure);
    const registry = new StorageRegistry({
      s3: makeDriver(),
      file: makeDriver(),
      "azure-blob": factory,
    });

    await registry.exists("s3://my-bucket/proj/sha256abc");
    expect(factory).not.toHaveBeenCalled();

    await registry.exists("azure-blob://account/container/proj/sha256abc");
    expect(factory).toHaveBeenCalledOnce();
  });
});
