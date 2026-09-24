import {
  createSsrfUrlValidator,
  type EgressTlsPolicy,
  fetchValidatedDestination,
  type SsrfUrlValidator,
} from "@langwatch/egress";

import type { ExternalImageChannel, ExternalImageResponse } from "../external-image.channel.ts";

/** How long the proxy waits for an outside address before giving up on it. */
export const EXTERNAL_IMAGE_TIMEOUT_MS = 30_000;

/** The address fence a deployment judges an outbound picture by. */
export type ExternalImageEgressPolicy = Readonly<{
  blockLocal: boolean;
  allowedHosts: readonly string[];
}>;

/** Every hop, redirects included, is validated and fetched at its validated address. */
export class HttpExternalImageChannel implements ExternalImageChannel {
  readonly #validate: SsrfUrlValidator;
  readonly #tls: EgressTlsPolicy;

  private constructor(validate: SsrfUrlValidator, tls: EgressTlsPolicy) {
    this.#validate = validate;
    this.#tls = tls;
  }

  static create(options: { policy: ExternalImageEgressPolicy }): HttpExternalImageChannel {
    return new HttpExternalImageChannel(
      createSsrfUrlValidator({
        blockLocal: options.policy.blockLocal,
        allowedHosts: [...options.policy.allowedHosts],
      }),
      { rejectUnauthorized: true },
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
      const body = new Uint8Array(await response.arrayBuffer());

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        bytes: async () => body,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
