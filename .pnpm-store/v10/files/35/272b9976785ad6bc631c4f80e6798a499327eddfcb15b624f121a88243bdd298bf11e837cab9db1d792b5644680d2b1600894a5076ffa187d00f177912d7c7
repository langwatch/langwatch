import type { Exact } from "../transform/exact";
/**
 * A checked type that resolves to Blob if it is defined as more than a stub, otherwise
 * resolves to 'never' so as not to widen the type of unions containing Blob
 * excessively.
 *
 * @public
 */
export type BlobOptionalType = BlobDefined extends true ? Blob : Unavailable;
/**
 * A checked type that resolves to ReadableStream if it is defined as more than a stub, otherwise
 * resolves to 'never' so as not to widen the type of unions containing ReadableStream
 * excessively.
 *
 * @public
 */
export type ReadableStreamOptionalType = ReadableStreamDefined extends true ? ReadableStream : Unavailable;
/**
 * Indicates a type is unavailable if it resolves to this.
 *
 * @public
 */
export type Unavailable = never;
/**
 * Whether the global types define more than a stub for ReadableStream.
 *
 * @internal
 */
export type ReadableStreamDefined = Exact<ReadableStream, {}> extends true ? false : true;
/**
 * Whether the global types define more than a stub for Blob.
 *
 * @internal
 */
export type BlobDefined = Exact<Blob, {}> extends true ? false : true;
