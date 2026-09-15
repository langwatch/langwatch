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
   * Whether an outbound TLS certificate is verified.
   *
   * Deliberately its own value rather than derived from `blockLocal`: on-prem
   * operators routinely call services with self-signed certificates, which has
   * nothing to do with whether private addresses are reachable, and tying the
   * two means one of the two deployments gets the wrong answer.
   */
  verifyTls: boolean;
}>;

/**
 * The guarded way out of the process for a credential probe against a customer-chosen URL —
 * routed through the shared SSRF fence (metadata denylist, private-address block, IP pinning).
 * Redirects are refused rather than followed, since a cross-origin redirect can carry
 * `x-api-key`/`x-goog-api-key`/`xi-api-key` straight through to the new host.
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
