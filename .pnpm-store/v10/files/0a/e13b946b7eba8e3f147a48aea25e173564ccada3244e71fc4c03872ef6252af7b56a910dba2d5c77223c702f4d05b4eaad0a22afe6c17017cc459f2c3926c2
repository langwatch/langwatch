/**
 * @module
 * Compress Middleware for Hono.
 */
import type { MiddlewareHandler } from '../../types';
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from '../../utils/compress';
export { COMPRESSIBLE_CONTENT_TYPE_REGEX };
declare const ENCODING_TYPES: readonly ["gzip", "deflate"];
type Encoding = (typeof ENCODING_TYPES)[number];
type ContentTypeFilter = RegExp | ((contentType: string) => boolean);
interface CompressionOptions {
    encoding?: Encoding;
    threshold?: number;
    contentTypeFilter?: ContentTypeFilter;
}
/**
 * Compress Middleware for Hono.
 *
 * @see {@link https://hono.dev/docs/middleware/builtin/compress}
 *
 * @param {CompressionOptions} [options] - The options for the compress middleware.
 * @param {'gzip' | 'deflate'} [options.encoding] - The compression scheme to allow for response compression. Either 'gzip' or 'deflate'. If not defined, both are allowed and will be used based on the Accept-Encoding header. 'gzip' is prioritized if this option is not provided and the client provides both in the Accept-Encoding header.
 * @param {number} [options.threshold=1024] - The minimum size in bytes to compress. Defaults to 1024 bytes.
 * @param {RegExp | Function} [options.contentTypeFilter=COMPRESSIBLE_CONTENT_TYPE_REGEX] - A RegExp or function to determine if the response Content-Type should be compressed.
 * @returns {MiddlewareHandler} The middleware handler function.
 *
 * @example
 * ```ts
 * const app = new Hono()
 *
 * app.use(compress())
 *
 * // Compress only JSON responses
 * app.use(compress({ contentTypeFilter: /^application\/json/ }))
 *
 * // Compress based on custom Content-Type logic
 * app.use(compress({ contentTypeFilter: (type) => COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type) || type === "application/x-myformat" }))
 * ```
 */
export declare const compress: (options?: CompressionOptions) => MiddlewareHandler;
