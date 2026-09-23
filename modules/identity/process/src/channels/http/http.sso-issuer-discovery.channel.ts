import {
  createSsrfUrlValidator,
  type EgressTlsPolicy,
  type FencedFetchOptions,
  RedirectRefusedError,
  type SsrfUrlValidator,
  type SsrfValidationResult,
  fetchValidatedDestination,
} from "@langwatch/egress";
import { createLogger } from "@langwatch/observability";

import {
  discoveryEndpointFor,
  looksLikeDiscoveryDocument,
} from "../../rules/sso-idp-registration.rules.ts";
import type {
  SsoIssuerDiscovery,
  SsoIssuerDiscoveryChannel,
} from "../sso-issuer-discovery.channel.ts";
import type { SsoDomainProofEgressPolicy } from "./http.sso-domain-proof-file.channel.ts";

const logger = createLogger("langwatch:identity:sso-issuer-discovery");

/** A discovery journey may canonicalise, but not wander, and not for long. */
const DISCOVERY_TIMEOUT_MS = 5_000;

/** What this channel reads of an answered fetch, and nothing else. */
export interface DiscoveryResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** The fenced fetch seam, injected so a test never opens a socket. */
export type FencedDiscoveryFetch = (
  validated: SsrfValidationResult,
  init: FencedFetchOptions,
  tls: EgressTlsPolicy,
) => Promise<DiscoveryResponse>;

/** A hop that left https. A document read over plain http could have been
 *  answered by anybody in between, and the credentials an administrator is
 *  about to store are dialled against whatever it says. */
class DiscoveryDowngradedError extends Error {
  constructor() {
    super("a discovery document is only read over https");
  }
}

/** A vouched origin whose name answered nothing: vouching is not evidence of an address. */
class VouchedOriginUnresolvableError extends Error {
  constructor() {
    super("a vouched issuer origin did not resolve");
  }
}

/**
 * The SAME guarded fetch the file proof makes, for the same reason: the
 * issuer is a string an administrator typed, so `http://169.254.169.254/…`
 * would otherwise make a registration form a reachability oracle.
 */
export class HttpsSsoIssuerDiscoveryChannel implements SsoIssuerDiscoveryChannel {
  private constructor(
    private readonly validate: SsrfUrlValidator,
    private readonly validateVouched: SsrfUrlValidator,
    private readonly dialableInternalOrigins: () => readonly string[],
    private readonly fetchValidated: FencedDiscoveryFetch,
    private readonly tls: EgressTlsPolicy,
  ) {}

  static create(options: {
    policy: SsoDomainProofEgressPolicy;
    /** Origins an operator named in advance, which may answer privately. */
    dialableInternalOrigins?: () => readonly string[];
    validate?: SsrfUrlValidator;
    validateVouched?: SsrfUrlValidator;
    fetchValidated?: FencedDiscoveryFetch;
  }): HttpsSsoIssuerDiscoveryChannel {
    return new HttpsSsoIssuerDiscoveryChannel(
      options.validate ??
        createSsrfUrlValidator({
          blockLocal: options.policy.blockLocal,
          allowedHosts: [...options.policy.allowedHosts],
        }),
      options.validateVouched ?? createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] }),
      options.dialableInternalOrigins ?? (() => []),
      options.fetchValidated ?? fetchValidatedDestination,
      { rejectUnauthorized: options.policy.verifyTls },
    );
  }

  /**
   * Every hop, the first included: https, then the deployment's fence. A
   * vouched origin skips the private-address refusal for that hop only, so
   * vouching never travels with a redirect.
   */
  private readonly judge: SsrfUrlValidator = async (url) => {
    if (!url.toLowerCase().startsWith("https://")) throw new DiscoveryDowngradedError();
    if (!this.dialableInternalOrigins().includes(new URL(url).origin)) return this.validate(url);

    const vouched = await this.validateVouched(url);
    if (vouched.type === "unresolved") throw new VouchedOriginUnresolvableError();

    return vouched;
  };

  async discover({ issuer }: { issuer: string }): Promise<SsoIssuerDiscovery> {
    const endpoint = discoveryEndpointFor({ issuer });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
      const validated = await this.judge(endpoint);
      const response = await this.fetchValidated(
        validated,
        {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
          followRedirects: true,
          revalidate: this.judge,
        },
        this.tls,
      );
      if (!response.ok) return { reachable: false, reason: `answered ${response.status}` };

      return looksLikeDiscoveryDocument(await response.json())
        ? { reachable: true }
        : { reachable: false, reason: "answered something else" };
    } catch (error) {
      const reason = reasonFor({ error, aborted: controller.signal.aborted });
      logger.warn({ issuer, endpoint, reason, error }, "an sso issuer could not be reached");

      return { reachable: false, reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * One sentence per refusal, and deliberately no more: which internal name
 * resolved where is not something the person typing an issuer gets to learn
 * from us.
 */
function reasonFor({ error, aborted }: { error: unknown; aborted: boolean }): string {
  if (error instanceof DiscoveryDowngradedError) return "not_https";
  if (error instanceof VouchedOriginUnresolvableError) return "unresolvable";
  if (error instanceof RedirectRefusedError) return "redirect_refused";
  if (aborted) return "timeout";
  const code =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;

  return code ?? (error instanceof Error ? "host_refused" : "fetch_failed");
}
