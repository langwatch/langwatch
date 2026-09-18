// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type EgressFetch,
  fetchFollowingPublicHosts,
  type HostResolver,
  pinnedFetch,
  systemHostResolver,
} from "~/server/app-layer/identity/public-egress";
import {
  discoveryEndpointFor,
  type SsoIssuerDiscoveryPort,
} from "./sso-idp-registration";

/**
 * Asking an OpenID Connect issuer whether it is one (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * The check runs once, at registration, and its whole job is to turn "I typed
 * the address wrong" into a sentence on the screen the administrator is
 * looking at, instead of a redirect that fails an hour later on somebody
 * else's sign-in.
 *
 * What it does NOT do is validate the document beyond the two fields anything
 * would need. The engine reads it properly at sign-in, and a second opinion
 * here would eventually disagree with the one that matters.
 *
 * IT IS THE SAME FETCH THE FILE PROOF MAKES, and it is guarded the same way.
 * The issuer is a string an organization administrator typed, and this
 * process is what dials it — so `http://169.254.169.254/…` or
 * `https://10.0.0.5:9200` would otherwise turn a registration form into a
 * reachability oracle for the cluster, with the result handed straight back
 * to the caller as `answered 403` / `answered 200` / `TimeoutError`. Every
 * hop is resolved, judged public, and pinned before a socket opens, by the
 * one guard both ceremonies share (`public-egress.ts`).
 */
const DISCOVERY_TIMEOUT_MS = 5_000;

/** A discovery journey may canonicalise, but not wander. */
const DISCOVERY_MAX_REDIRECTS = 5;

export class HttpSsoIssuerDiscovery implements SsoIssuerDiscoveryPort {
  /**
   * Both seams are injected for the reason the file lookup's are: the guard
   * that refuses a name resolving into private space is the interesting half,
   * and a test that had to make a real DNS query to reach it would be a test
   * that needs the network to say anything at all.
   */
  constructor(
    private readonly fetchImpl: EgressFetch = pinnedFetch,
    private readonly resolveHost: HostResolver = systemHostResolver,
    /** Origins somebody vouched for, which may answer inside a private
     *  network. Resolved by the composition root — see
     *  `dialable-internal-origins.ts`. Empty means the guard's plain rule. */
    private readonly dialableInternalOrigins: string[] = [],
  ) {}

  async discover({
    issuer,
  }: {
    issuer: string;
  }): Promise<{ reachable: true } | { reachable: false; reason: string }> {
    let url: URL;
    try {
      url = new URL(discoveryEndpointFor({ issuer }));
    } catch {
      return { reachable: false, reason: "not an address" };
    }
    // https ONLY. A discovery document read over plain http could have been
    // answered by anybody between us and the issuer, and the credentials an
    // administrator is about to store are dialed against whatever it says.
    if (url.protocol !== "https:") {
      return { reachable: false, reason: `unsupported scheme ${url.protocol}` };
    }

    try {
      const outcome = await fetchFollowingPublicHosts({
        url: url.toString(),
        fetchImpl: this.fetchImpl,
        resolveHost: this.resolveHost,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        headers: { accept: "application/json" },
        maxRedirects: DISCOVERY_MAX_REDIRECTS,
        dialableInternalOrigins: this.dialableInternalOrigins,
      });

      if (!outcome.ok) {
        // One sentence for every refusal the guard makes, and deliberately:
        // which internal name resolved where is not something the person
        // typing an issuer gets to learn from us.
        return { reachable: false, reason: "not an address we will dial" };
      }

      const { response } = outcome;
      if (!response.ok) {
        return { reachable: false, reason: `answered ${response.status}` };
      }
      const document: unknown = await response.json();
      return looksLikeDiscoveryDocument(document)
        ? { reachable: true }
        : { reachable: false, reason: "answered something else" };
    } catch (error) {
      return { reachable: false, reason: describeThrow(error) };
    }
  }
}

/**
 * What went wrong, in enough detail to act on.
 *
 * This used to be `error.name`, which for anything undici throws is the
 * single word `TypeError` — true, and worth nothing. A misconfigured
 * dispatcher, an expired certificate, a refused connection and a timeout all
 * arrived as that one word, so the only way to tell them apart was to
 * reproduce the fetch by hand outside the process. The cause carries the code
 * that actually distinguishes them.
 *
 * This reaches the LOG, not the customer: the refusal the caller sees is
 * `sso_issuer_unreachable` and carries none of this, which is the same rule
 * the guard's own refusals follow.
 */
function describeThrow(error: unknown): string {
  if (!(error instanceof Error)) return "unreachable";
  const cause: unknown = error.cause;
  if (cause instanceof Error && "code" in cause) {
    return `${error.name} (${String(cause.code)})`;
  }
  return error.name;
}

/** The two endpoints every OpenID Connect provider publishes and every
 *  authorization-code flow needs. Anything without them is not a provider we
 *  could dial whatever else it says. */
function looksLikeDiscoveryDocument(document: unknown): boolean {
  if (typeof document !== "object" || document === null) return false;
  const record = document as Record<string, unknown>;
  return (
    typeof record.authorization_endpoint === "string" &&
    typeof record.token_endpoint === "string"
  );
}
