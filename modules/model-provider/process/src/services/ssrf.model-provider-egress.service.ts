import {
  createSsrfUrlValidator,
  fetchValidatedDestination,
  RedirectRefusedError,
  type SsrfUrlValidator,
} from "@langwatch/egress";

import {
  ModelProviderEgress,
  type ModelProviderEgressRequest,
  type ModelProviderEgressResponse,
} from "../app/model-provider.members.ts";

/** The address policy a deployment fences its outbound probes with. */
export type ModelProviderEgressPolicy = Readonly<{
  /** Refuse private, loopback and link-local destinations, and names resolving to them. */
  blockLocal: boolean;
  /** The literal hostname allowlist that relaxes the local block, and only it. */
  allowedHosts: readonly string[];
  /**
   * Whether an outbound TLS certificate is verified. Deliberately its own
   * value rather than derived from `blockLocal`: on-prem operators routinely
   * hit self-signed certs, unrelated to whether private addresses are reachable.
   */
  verifyTls: boolean;
}>;

/**
 * The guarded way out of the process for a credential probe against a
 * customer URL, routed through the shared SSRF fence (denylist, private
 * block, IP pinning). Redirects are refused, since one could leak an API key.
 */
export class SsrfModelProviderEgressAdapter extends ModelProviderEgress {
  static create(input: { policy: ModelProviderEgressPolicy }): SsrfModelProviderEgressAdapter {
    return new SsrfModelProviderEgressAdapter(
      createSsrfUrlValidator({
        blockLocal: input.policy.blockLocal,
        allowedHosts: [...input.policy.allowedHosts],
      }),
      input.policy.verifyTls,
    );
  }

  private constructor(
    private readonly validate: SsrfUrlValidator,
    private readonly verifyTls: boolean,
  ) {
    super();
  }

  async fetch(
    url: string,
    request: ModelProviderEgressRequest,
  ): Promise<ModelProviderEgressResponse> {
    const validated = await this.validate(url);
    const response = await fetchValidatedDestination(
      validated,
      {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: request.signal,
        followRedirects: false,
      },
      { rejectUnauthorized: this.verifyTls },
    );
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
    };
  }

  isRedirectRefusal(error: unknown): boolean {
    return error instanceof RedirectRefusedError;
  }
}
