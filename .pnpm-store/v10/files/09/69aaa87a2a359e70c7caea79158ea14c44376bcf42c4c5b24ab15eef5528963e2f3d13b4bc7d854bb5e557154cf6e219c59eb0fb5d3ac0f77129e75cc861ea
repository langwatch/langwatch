/**
 * This module provides internal shims and utility functions for environments where certain Node.js or global types may not be available.
 *
 * These are used to ensure we can provide a consistent behaviour between different JavaScript environments and good error
 * messages in cases where an environment isn't fully supported.
 */
import type { Fetch } from "./builtin-types.mjs";
import type { ReadableStream } from "./shim-types.mjs";
export declare function getDefaultFetch(): Fetch;
type ReadableStreamArgs = ConstructorParameters<typeof ReadableStream>;
export declare function makeReadableStream(...args: ReadableStreamArgs): ReadableStream;
export declare function ReadableStreamFrom<T>(iterable: Iterable<T> | AsyncIterable<T>): ReadableStream<T>;
/**
 * Most browsers don't yet have async iterable support for ReadableStream,
 * and Node has a very different way of reading bytes from its "ReadableStream".
 *
 * This polyfill was pulled from https://github.com/MattiasBuelens/web-streams-polyfill/pull/122#issuecomment-1627354490
 */
export declare function ReadableStreamToAsyncIterable<T>(stream: any): AsyncIterableIterator<T>;
/**
 * Cancels a ReadableStream we don't need to consume.
 * See https://undici.nodejs.org/#/?id=garbage-collection
 */
export declare function CancelReadableStream(stream: any): Promise<void>;
export {};
//# sourceMappingURL=shims.d.mts.map