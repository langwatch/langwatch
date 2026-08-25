import {
  discoveryEndpointFor,
  type SsoIssuerDiscoveryPort,
} from "@langwatch/identity-server";

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
 */
const DISCOVERY_TIMEOUT_MS = 5_000;

export class HttpSsoIssuerDiscovery implements SsoIssuerDiscoveryPort {
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
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { reachable: false, reason: `unsupported scheme ${url.protocol}` };
    }
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { reachable: false, reason: `answered ${response.status}` };
      }
      const document: unknown = await response.json();
      return looksLikeDiscoveryDocument(document)
        ? { reachable: true }
        : { reachable: false, reason: "answered something else" };
    } catch (error) {
      return {
        reachable: false,
        reason: error instanceof Error ? error.name : "unreachable",
      };
    }
  }
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
