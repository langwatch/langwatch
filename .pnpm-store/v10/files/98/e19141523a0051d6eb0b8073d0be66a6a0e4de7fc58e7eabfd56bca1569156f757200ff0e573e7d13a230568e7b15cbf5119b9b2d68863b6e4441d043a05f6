import type { Readable } from "node:stream";
import type { BlobOptionalType, ReadableStreamOptionalType } from "../externals-check/browser-externals-check";
/**
 * This is the union representing the modeled blob type with streaming trait
 * in a generic format that does not relate to HTTP input or output payloads.
 * Note: the non-streaming blob type is represented by Uint8Array, but because
 * the streaming blob type is always in the request/response paylod, it has
 * historically been handled with different types.
 * For compatibility with its historical representation, it must contain at least
 * Readble (Node.js), Blob (browser), and ReadableStream (browser).
 *
 * @public
 * @see https://smithy.io/2.0/spec/simple-types.html#blob
 * @see StreamingPayloadInputTypes for FAQ about mixing types from multiple environments.
 */
export type StreamingBlobTypes = NodeJsRuntimeStreamingBlobTypes | BrowserRuntimeStreamingBlobTypes;
/**
 * Node.js streaming blob type.
 *
 * @public
 */
export type NodeJsRuntimeStreamingBlobTypes = Readable;
/**
 * Browser streaming blob types.
 *
 * @public
 */
export type BrowserRuntimeStreamingBlobTypes = ReadableStreamOptionalType | BlobOptionalType;
