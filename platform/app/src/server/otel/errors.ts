import { HandledError } from "@langwatch/handled-error";

/**
 * An OTLP body passed the number of bytes we are willing to hold, either on the
 * wire or after decompression.
 *
 * Both stages need a bound and neither can express the other. `bodyLimit` only
 * ever sees the compressed bytes, so a request well inside the advertised
 * 10 MiB still decompresses to hundreds of megabytes, or to gigabytes at Node's
 * own default. That is a decompression bomb: cheap to send, expensive to
 * receive, and it exhausts the process before anything downstream gets a chance
 * to reject it. An uncompressed body has no such ratio, but it is read whole
 * before any of this, so a route without a wire limit is exposed to the plain
 * version of the same attack.
 *
 * 413 rather than 400, because the request is well-formed. The sender's
 * remedy is a smaller batch, which is a thing OTLP exporters are already
 * configured to do.
 */
export class OtlpBodyTooLargeError extends HandledError {
  declare readonly code: "ERR_PAYLOAD_TOO_LARGE";

  /**
   * `encoding` is the `Content-Encoding` the body arrived under, or null when
   * the limit was hit reading the wire bytes rather than expanding them.
   */
  constructor({
    maxBytes,
    encoding,
  }: {
    maxBytes: number;
    encoding: string | null;
  }) {
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
 * The request body could not be read to the end.
 *
 * Overwhelmingly this is an exporter that gave up mid-upload: its own timeout
 * fires, it drops the connection, and the half-read stream is torn down under
 * us. It is also what an already-consumed body raises ("Body is unusable").
 *
 * 400 and `customer`, because nothing here is ours to fix — the bytes never
 * arrived. Left unclassified it reached the request boundary as an unhandled
 * error and was answered 500, which put a disconnecting client into the same
 * bucket as a broken receiver and made the 5xx rate unreadable.
 *
 * The cause is carried on `reasons` rather than flattened into the message:
 * which condition ended the read (abort, reset, already-consumed) is the only
 * diagnosis this error has, and the message cannot hold it.
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
    super(
      "ERR_UNSUPPORTED_ENCODING",
      `Unsupported Content-Encoding: ${encoding}`,
      {
        meta: { encoding },
        httpStatus: 400,
        fault: "customer",
        tips: [
          "Send the body uncompressed, or with gzip, deflate or br encoding.",
        ],
      },
    );
    this.name = "OtlpUnsupportedEncodingError";
  }
}
