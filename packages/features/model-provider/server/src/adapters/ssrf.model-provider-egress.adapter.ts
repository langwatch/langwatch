import {
  createSsrfUrlValidator,
  fetchValidatedDestination,
  RedirectRefusedError,
  type SsrfUrlValidator,
} from "@langwatch/egress";
import {
  ModelProviderEgressPort,
  type ModelProviderEgressRequest,
  type ModelProviderEgressResponse,
} from "../ports/model-provider.port";

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
 * The guarded way out of the process, for a credential probe.
 *
 * Every request it carries is a customer's credential going to a URL a
 * customer chose — several providers expose a configurable endpoint, and an
 * endpoint saved last month is as attacker-controlled as one supplied on this
 * call — so it goes through the shared SSRF fence: a cloud-metadata denylist
 * that no configuration relaxes, private-address blocking the deployment
 * configures, and IP pinning so a name cannot resolve to something else
 * between the check and the connection.
 *
 * Redirects are refused rather than followed. Measured on this repo's Node, a
 * cross-origin redirect strips `Authorization` but carries `x-api-key`,
 * `x-goog-api-key` and `xi-api-key` straight through to the new host, and a
 * models listing has no business hopping.
 */
export class SsrfModelProviderEgressAdapter extends ModelProviderEgressPort {
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
