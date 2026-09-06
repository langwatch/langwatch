/**
 * One response stream's Lambda Web Adapter framing state. `read` answers what
 * Studio should receive, which is nothing until the prelude is complete: AWS
 * may split the prelude across chunks, and half a prelude is not a body.
 */
import {
  LWA_DEFAULT_STATUS,
  LWA_PRELUDE_SEPARATOR_LENGTH,
  findLwaPreludeSeparator,
  readLwaPreludeStatus,
} from "../rules/lambda-web-adapter-stream.rules";

/** Allocates a new array holding `first` followed by `second`. */
function concatBytes(
  first: Uint8Array<ArrayBufferLike>,
  second: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);
  return merged;
}

export class LambdaWebAdapterStreamService {
  static create(): LambdaWebAdapterStreamService {
    return new LambdaWebAdapterStreamService();
  }

  private preludeRead = false;
  private buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private status = LWA_DEFAULT_STATUS;

  private constructor() {}

  /** The status the prelude declared, or the legacy default until it is read. */
  get statusCode(): number {
    return this.status;
  }

  /** Whether the prelude has been seen; false at the end means a broken frame. */
  get preludeComplete(): boolean {
    return this.preludeRead;
  }

  read(chunk: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
    if (this.preludeRead) return chunk;

    const merged = concatBytes(this.buffered, chunk);
    const separator = findLwaPreludeSeparator(merged);
    if (separator === -1) {
      this.buffered = merged;
      return new Uint8Array(0);
    }

    this.status = readLwaPreludeStatus(merged.slice(0, separator));
    this.preludeRead = true;
    this.buffered = new Uint8Array(0);
    return merged.slice(separator + LWA_PRELUDE_SEPARATOR_LENGTH);
  }
}
