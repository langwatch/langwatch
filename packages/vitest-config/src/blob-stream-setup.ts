import { DecompressionStream, ReadableStream } from "node:stream/web";

/** The part of a Blob this setup reads and fills in. */
export interface StreamableBlob {
  arrayBuffer(): Promise<ArrayBuffer>;
  stream?(): ReadableStream<Uint8Array<ArrayBuffer>>;
}

/**
 * jsdom's Blob has no stream(), which browsers and Node both have; shiki's inlined wasm
 * loader calls it on import. Reads the bytes through arrayBuffer() where stream() is missing.
 */
export function ensureBlobStream(blobClass: { prototype: StreamableBlob }): void {
  if (typeof blobClass.prototype.stream === "function") return;

  blobClass.prototype.stream = function stream(this: StreamableBlob) {
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      start: async (controller) => {
        controller.enqueue(new Uint8Array(await this.arrayBuffer()));
        controller.close();
      },
    });
  };
}

if (typeof Blob !== "undefined") ensureBlobStream(Blob);
// Some jsdom suites see no DecompressionStream either, which the same loader pipes through.
if (!("DecompressionStream" in globalThis)) Object.assign(globalThis, { DecompressionStream });
