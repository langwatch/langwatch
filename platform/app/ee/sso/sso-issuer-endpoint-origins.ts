// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type HostResolver,
  publicHopFor,
  systemHostResolver,
} from "~/server/app-layer/identity/public-egress";
import type { SsoIssuerDiscoveryPort } from "./sso-idp-registration";

/**
 * The origins a registered issuer's discovery document sends a sign-in to.
 *
 * The SSO engine reads the discovery document at sign-in and refuses any
 * endpoint whose origin is not trusted (`discovery_untrusted_origin`). Some
 * providers serve their endpoints from another origin than the issuer:
 * Google's token, userinfo and keys live on `*.googleapis.com`, and an AWS
 * Cognito user pool serves authorize, token and userinfo from its hosted UI
 * domain. Those origins are trusted for a request that names the issuer.
 *
 * A trusted origin skips the engine's own private-address check, so an origin
 * is only returned when it is https and every address its host resolves to is
 * public (or one an operator vouched for in `SSO_TRUSTED_IDP_ORIGINS`).
 * Answers are cached per issuer, so a sign-in reads the document from the
 * cache.
 */

const FOUND_TTL_MS = 10 * 60_000;
const MISSING_TTL_MS = 60_000;

export class SsoIssuerEndpointOrigins {
  readonly #cache = new Map<string, { origins: string[]; expiresAt: number }>();

  constructor(
    private readonly deps: {
      discovery: SsoIssuerDiscoveryPort;
      resolveHost?: HostResolver;
      dialableInternalOrigins?: string[];
      now?: () => number;
    },
  ) {}

  async originsFor(issuers: readonly string[]): Promise<string[]> {
    const all = await Promise.all(
      issuers.map((issuer) => this.#originsOf(issuer)),
    );
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
      try {
        const url = new URL(endpoint);
        if (url.protocol === "https:") candidates.add(url.origin);
      } catch {
        // Not an address; the engine refuses it on its own.
      }
    }
    const checked = await Promise.all(
      [...candidates].map(async (origin) => {
        const hop = await publicHopFor({
          url: origin,
          resolveHost: this.deps.resolveHost ?? systemHostResolver,
          dialableInternalOrigins: this.deps.dialableInternalOrigins ?? [],
        }).catch(() => ({ ok: false as const }));
        return hop.ok ? origin : null;
      }),
    );
    return checked.filter((origin): origin is string => origin !== null);
  }
}
