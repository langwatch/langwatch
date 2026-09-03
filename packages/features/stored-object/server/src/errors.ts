/**
 * Failures the byte layer raises, as its callers recognise them.
 *
 * One class, because the storage drivers only ever have one thing to say that
 * a caller can act on: the address resolved, and nothing is there. Every other
 * provider failure — a refused credential, a network reset, a bucket policy —
 * stays itself, so it degrades to an unknown error with a trace id rather than
 * being reported to a reader as "your file is gone".
 */

/** Raised when a storage address resolves but holds no bytes. */
export class ObjectNotFoundError extends Error {
  constructor(uri: string) {
    super(`Object not found: ${uri}`);
    this.name = "ObjectNotFoundError";
  }
}
