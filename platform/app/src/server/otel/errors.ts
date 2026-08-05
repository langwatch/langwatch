import { HandledError } from "@langwatch/handled-error";

/**
 * A compressed OTLP body expanded past what we are willing to hold.
 *
 * `bodyLimit` only ever sees the compressed bytes, so a request that is well
 * inside the advertised 10 MiB can still decompress to hundreds of megabytes,
 * or to gigabytes at Node's own default. That is a decompression bomb: cheap
 * to send, expensive to receive, and it exhausts the process before anything
 * downstream gets a chance to reject it.
 *
 * 413 rather than 400, because the request is well-formed. The sender's
 * remedy is a smaller batch, which is a thing OTLP exporters are already
 * configured to do.
 */
export class OtlpBodyTooLargeError extends HandledError {
  declare readonly code: "ERR_PAYLOAD_TOO_LARGE";

  constructor({
    maxDecompressedBytes,
    encoding,
  }: {
    maxDecompressedBytes: number;
    encoding: string;
  }) {
    super(
      "ERR_PAYLOAD_TOO_LARGE",
      `Decompressed request body exceeds the ${maxDecompressedBytes} byte limit.`,
      {
        meta: { maxDecompressedBytes, encoding },
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
