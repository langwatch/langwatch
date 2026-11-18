// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ensureBlobStream, type StreamableBlob } from "../blob-stream-setup.ts";

/** A Blob as jsdom ships it: bytes through arrayBuffer(), no stream(). */
class StreamlessBlob implements StreamableBlob {
  declare stream?: () => ReadableStream<Uint8Array<ArrayBuffer>>;

  constructor(private readonly bytes: Uint8Array<ArrayBuffer>) {}

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.bytes.buffer);
  }
}

const ownStream = (blobClass: { prototype: object }): unknown =>
  Object.getOwnPropertyDescriptor(blobClass.prototype, "stream")?.value;

describe("ensureBlobStream", () => {
  describe("given a Blob class without stream()", () => {
    it("streams the blob's bytes", async () => {
      ensureBlobStream(StreamlessBlob);
      const stream = new StreamlessBlob(new Uint8Array([1, 2, 3])).stream?.();

      expect(stream).toBeDefined();
      await expect(new Response(stream).bytes()).resolves.toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe("given a Blob class that has stream()", () => {
    it("leaves it alone", () => {
      const own = ownStream(Blob);

      ensureBlobStream(Blob);

      expect(ownStream(Blob)).toBe(own);
    });
  });
});
