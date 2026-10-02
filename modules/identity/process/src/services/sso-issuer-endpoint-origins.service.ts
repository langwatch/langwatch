import { isIP } from "node:net";

import { BLOCKED_METADATA_HOSTS, isPrivateOrLocalhostIP } from "@langwatch/egress";

import type { HostAddressResolver } from "../channels/dns.host-addresses.channel.ts";
import type { SsoIssuerDiscoveryChannel } from "../channels/sso-issuer-discovery.channel.ts";

const FOUND_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 60_000;

export interface SsoIssuerEndpointOriginsServiceDeps {
  discovery: SsoIssuerDiscoveryChannel;
  resolveHost: HostAddressResolver;
  /** Origins an operator vouched for (`SSO_TRUSTED_IDP_ORIGINS`), which may
   *  answer privately. Asked per lookup, not at boot. */
  dialableInternalOrigins?: () => readonly string[];
  now?: () => number;
}

/**
 * The origins a registered issuer's discovery document sends a sign-in to (Google
 * serves keys from `*.googleapis.com`): https only, every address public unless an
 * operator vouched for it, since trust skips the engine's private-address check.
 */
export class SsoIssuerEndpointOriginsService {
  static create(deps: SsoIssuerEndpointOriginsServiceDeps): SsoIssuerEndpointOriginsService {
    return new SsoIssuerEndpointOriginsService(deps);
  }

  readonly #cache = new Map<string, { origins: string[]; expiresAt: number }>();

  private constructor(private readonly deps: SsoIssuerEndpointOriginsServiceDeps) {}

  async findEndpointOrigins({ issuers }: { issuers: readonly string[] }): Promise<string[]> {
    const all = await Promise.all(issuers.map((issuer) => this.#originsOf(issuer)));
    return [...new Set(all.flat())];
  }

  async #originsOf(issuer: string): Promise<string[]> {
    const now = (this.deps.now ?? Date.now)();
    const cached = this.#cache.get(issuer);
    if (cached && cached.expiresAt > now) return cached.origins;

    // A SAML entity id is an issuer too, and has no discovery document.
    const answer = await this.deps.discovery
      .discover({ issuer })
      .catch(() => ({ reachable: false as const, reason: "unreachable" }));
    const endpoints = answer.reachable ? (answer.endpoints ?? []) : [];
    const origins = await this.#publicOrigins(endpoints);
    this.#pruneExpired(now);
    this.#cache.set(issuer, {
      origins,
      expiresAt: now + (answer.reachable ? FOUND_TTL_MS : MISSING_TTL_MS),
    });
    return origins;
  }

  #pruneExpired(now: number): void {
    for (const [issuer, entry] of this.#cache) {
      if (entry.expiresAt <= now) this.#cache.delete(issuer);
    }
  }

  async #publicOrigins(endpoints: readonly string[]): Promise<string[]> {
    const candidates = new Set<string>();
    for (const endpoint of endpoints) {
      // Not an address, or not https: the engine refuses it on its own.
      const url = URL.parse(endpoint);
      if (url?.protocol === "https:") candidates.add(url.origin);
    }
    const checked = await Promise.all(
      [...candidates].map(async (origin) => ((await this.#isPublic(origin)) ? origin : null)),
    );
    return checked.filter((origin): origin is string => origin !== null);
  }

  async #isPublic(origin: string): Promise<boolean> {
    if ((this.deps.dialableInternalOrigins?.() ?? []).includes(origin)) return true;
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if ((BLOCKED_METADATA_HOSTS as readonly string[]).includes(host)) return false;
    const addresses = isIP(host) === 0 ? await this.deps.resolveHost(host).catch(() => []) : [host];
    return addresses.length > 0 && addresses.every((address) => !isPrivateOrLocalhostIP(address));
  }
}
