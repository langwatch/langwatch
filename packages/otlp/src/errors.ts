import { HandledError } from "@langwatch/handled-error";

/**
 * An OTLP body passed the number of bytes we are willing to hold, on the wire
 * or after decompression — a small compressed request can still decompress
 * to a decompression bomb. 413, not 400, since the request is well-formed.
 */
export class OtlpBodyTooLargeError extends HandledError {
  declare readonly code: "ERR_PAYLOAD_TOO_LARGE";

  /**
   * `encoding` is the `Content-Encoding` the body arrived under, or null when
   * the limit was hit reading the wire bytes rather than expanding them.
   */
  constructor({ maxBytes, encoding }: { maxBytes: number; encoding: string | null }) {
    super(
      "ERR_PAYLOAD_TOO_LARGE",
      encoding === null
        ? `Request body exceeds the ${maxBytes} byte limit.`
        : `Decompressed request body exceeds the ${maxBytes} byte limit.`,
      {
        meta: { maxBytes, encoding },
        httpStatus: 413,
        fault: "customer",
        tips: [
          "Send smaller batches, by lowering the exporter's max batch size or shortening its export interval.",
        ],
      },
    );
    this.name = "OtlpBodyTooLargeError";
  }
}

/**
 * The request body could not be read to the end — usually an exporter that
 * gave up mid-upload. 400 and `customer`, because nothing here is ours to
 * fix: the bytes never arrived, so it must not pollute the 5xx rate.
 */
export class OtlpBodyUnreadableError extends HandledError {
  declare readonly code: "ERR_BODY_UNREADABLE";

  constructor({ cause }: { cause?: unknown } = {}) {
    super("ERR_BODY_UNREADABLE", "Request body could not be read.", {
      httpStatus: 400,
      fault: "customer",
      reasons: cause instanceof Error ? [cause] : [],
      tips: [
        "This usually means the connection closed before the body finished uploading. Retry the export, and raise the exporter's timeout if it is sending large batches.",
      ],
    });
    this.name = "OtlpBodyUnreadableError";
  }
}

/**
 * The body arrived under a `Content-Encoding` the receiver does not implement.
 *
 * Named rather than left as a bare Error so it is answered 400 like the other
 * sender mistakes on this path, instead of reaching the boundary unclassified
 * and being counted as a server fault.
 */
export class OtlpUnsupportedEncodingError extends HandledError {
  declare readonly code: "ERR_UNSUPPORTED_ENCODING";

  constructor({ encoding }: { encoding: string }) {
    super("ERR_UNSUPPORTED_ENCODING", `Unsupported Content-Encoding: ${encoding}`, {
      meta: { encoding },
      httpStatus: 400,
      fault: "customer",
      tips: ["Send the body uncompressed, or with gzip, deflate or br encoding."],
    });
    this.name = "OtlpUnsupportedEncodingError";
  }
}
