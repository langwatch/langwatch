import {
  createSsrfUrlValidator,
  type EgressTlsPolicy,
  fetchValidatedDestination,
  type SsrfUrlValidator,
} from "@langwatch/egress";

import {
  type ExternalImageChannel,
  type ExternalImageResponse,
  ExternalImageTooLargeError,
} from "../external-image.channel.ts";

/** How long the proxy waits for an outside address, headers and body together. */
const EXTERNAL_IMAGE_TIMEOUT_MS = 30_000;

/** The largest picture the proxy holds in memory to relay. */
export const EXTERNAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

const NO_BYTES = new Uint8Array(new ArrayBuffer(0));

/** Reads a body up to the limit; the declared length is not trusted, every chunk is counted. */
async function readUpTo(
  body: AsyncIterable<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new ExternalImageTooLargeError();
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The address fence a deployment judges an outbound picture by. */
type ExternalImageEgressPolicy = Readonly<{
  blockLocal: boolean;
  allowedHosts: readonly string[];
  /** Main verified certificates only on the hosted product, so on-prem self-signed hosts load. */
  verifyTls: boolean;
}>;

/**
 * Every hop, redirects included, is validated and fetched at its validated address.
 * Only a successful picture answer has its body read, and only up to the size limit.
 */
export class HttpExternalImageChannel implements ExternalImageChannel {
  readonly #validate: SsrfUrlValidator;
  readonly #tls: EgressTlsPolicy;
  readonly #maxBytes: number;

  private constructor(validate: SsrfUrlValidator, tls: EgressTlsPolicy, maxBytes: number) {
    this.#validate = validate;
    this.#tls = tls;
    this.#maxBytes = maxBytes;
  }

  static create(options: {
    policy: ExternalImageEgressPolicy;
    maxBytes?: number;
  }): HttpExternalImageChannel {
    return new HttpExternalImageChannel(
      createSsrfUrlValidator({
        blockLocal: options.policy.blockLocal,
        allowedHosts: [...options.policy.allowedHosts],
      }),
      { rejectUnauthorized: options.policy.verifyTls },
      options.maxBytes ?? EXTERNAL_IMAGE_MAX_BYTES,
    );
  }

  async fetch(url: string): Promise<ExternalImageResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTERNAL_IMAGE_TIMEOUT_MS);
    try {
      const response = await fetchValidatedDestination(
        await this.#validate(url),
        {
          method: "GET",
          signal: controller.signal,
          followRedirects: true,
          revalidate: this.#validate,
        },
        this.#tls,
      );
      const contentType = response.headers.get("content-type");
      const answer = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType,
      };
      if (!response.ok || !contentType?.startsWith("image/")) {
        return { ...answer, bytes: async () => NO_BYTES };
      }

      if (Number(response.headers.get("content-length")) > this.#maxBytes) {
        throw new ExternalImageTooLargeError();
      }
      const body = await readUpTo(response.body, this.#maxBytes);

      return { ...answer, bytes: async () => body };
    } finally {
      clearTimeout(timer);
      // Drops whatever of the body was left unread, so the connection does not keep receiving it.
      controller.abort();
    }
  }
}
