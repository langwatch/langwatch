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
