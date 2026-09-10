/**
 * @vitest-environment node
 * The blob contract, stated once per backend: bytes are addressed by their
 * storage URI and read back whole, and a URI nothing was written to is absent.
 * @see modules/stored-object/specs/stored-objects.feature
 */
import { ObjectNotFoundError } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import { MemoryStoredObjectBlobRepository } from "../memory/memory.stored-object-blob.repository.ts";
import { MemoryStoredObjectBlobStore } from "../memory/memory-stored-object-blob.store.ts";
import type { StoredObjectStorageDriver } from "../stored-object-blob.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => StoredObjectStorageDriver }> = [
  { name: "memory", create: () => MemoryStoredObjectBlobRepository.create() },
];

const URI = "s3://bucket/project_acme/so_aaaaaaaa";
const BYTES = Buffer.from("the payload");

async function readAll(repository: StoredObjectStorageDriver, uri: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await repository.get(uri)) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

describe.each(backends)("given the $name stored-object blob repository", ({ create }) => {
  describe("when nothing was written to the uri", () => {
    it("answers that the uri holds no bytes", async () => {
      const repository = create();
      await expect(repository.exists(URI)).resolves.toBe(false);
    });

    it("refuses to read it", async () => {
      const repository = create();
      await expect(repository.get(URI)).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it("accepts a delete of it", async () => {
      const repository = create();
      await expect(repository.delete(URI)).resolves.toBeUndefined();
    });
  });

  describe("when bytes were written to the uri", () => {
    it("reads the same bytes back", async () => {
      const repository = create();
      await repository.put(URI, BYTES, "application/octet-stream");

      expect(await readAll(repository, URI)).toEqual(BYTES);
    });

    it("answers that the uri holds bytes", async () => {
      const repository = create();
      await repository.put(URI, BYTES, "application/octet-stream");

      await expect(repository.exists(URI)).resolves.toBe(true);
    });

    it("replaces them on a second write", async () => {
      const repository = create();
      await repository.put(URI, BYTES, "application/octet-stream");
      await repository.put(URI, Buffer.from("newer"), "text/plain");

      expect(await readAll(repository, URI)).toEqual(Buffer.from("newer"));
    });

    it("forgets them after a delete", async () => {
      const repository = create();
      await repository.put(URI, BYTES, "application/octet-stream");
      await repository.delete(URI);

      await expect(repository.exists(URI)).resolves.toBe(false);
    });

    it("leaves another uri untouched", async () => {
      const repository = create();
      await repository.put(URI, BYTES, "application/octet-stream");

      await expect(repository.exists(`${URI}-other`)).resolves.toBe(false);
    });
  });
});

describe("given two memory blob repositories over one store", () => {
  describe("when one of them writes bytes", () => {
    it("reads them back through the other", async () => {
      const store = MemoryStoredObjectBlobStore.create();
      const writer = MemoryStoredObjectBlobRepository.create(store);
      const reader = MemoryStoredObjectBlobRepository.create(store);

      await writer.put(URI, BYTES, "application/octet-stream");

      expect(await readAll(reader, URI)).toEqual(BYTES);
    });
  });
});
