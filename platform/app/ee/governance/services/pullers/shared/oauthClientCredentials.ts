// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * OAuth2 client-credentials token acquisition for puller adapters.
 *
 * The token lives in a closure created per run, NOT in a module-level cache.
 * Runs fire every 15 minutes against a token whose lifetime is roughly an
 * hour, so a per-run token costs about four extra token requests an hour —
 * trivially within limits — and buys back the whole of single-flight
 * coordination plus a shared mutable cache.
 *
 * The shared cache is also the shape most likely to go wrong here.
 * `pullerAdapter.ts` forbids per-source state on the adapter instance,
 * because the worker reuses one adapter across sources; a module-level token
 * map is the same hazard wearing a different hat, and keyed on tenant alone
 * it would hand one tenant another tenant's token. If token cost ever starts
 * to matter, that is the thing to add back — keyed on tenant + client +
 * scope together.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */

import { fetchWithRetry } from "./httpRetry";

/**
 * Refresh this far ahead of stated expiry. A token that expires while a
 * request is in flight is indistinguishable from a bad credential at the
 * other end, and produces a 401 that looks like misconfiguration.
 */
export const REFRESH_MARGIN_MS = 60_000;

export interface ClientCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface TokenProviderOptions {
  credentials: ClientCredentials;
  /** e.g. `https://manage.office.com/.default` */
  scope: string;
  signal?: AbortSignal;
  deadlineAtMs?: number;
  /** Injectable for tests. */
  now?: () => number;
  /** Injectable for tests; defaults to the real token endpoint. */
  tokenEndpoint?: (tenantId: string) => string;
}

export interface TokenProvider {
  /**
   * Returns a valid bearer token, fetching one on first call and refusing to
   * hand back one that would expire mid-flight.
   */
  getToken(): Promise<string>;
}

const defaultTokenEndpoint = (tenantId: string): string =>
  `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId,
  )}/oauth2/v2.0/token`;

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

/**
 * Thrown when the token endpoint refuses or answers with something
 * unusable. Deliberately carries no response body: the request that produced
 * it had the client secret in its form body, and an error that quotes the
 * exchange is the most likely way a secret reaches a log.
 */
export class TokenAcquisitionError extends Error {
  constructor(reason: string) {
    super(`OAuth client-credentials token request failed: ${reason}`);
    this.name = "TokenAcquisitionError";
  }
}

/**
 * Create a per-run token provider. Construct one at the start of a run and
 * let it fall out of scope when the run ends.
 */
export function createTokenProvider({
  credentials,
  scope,
  signal,
  deadlineAtMs,
  now = Date.now,
  tokenEndpoint = defaultTokenEndpoint,
}: TokenProviderOptions): TokenProvider {
  let token: string | null = null;
  let expiresAtMs = 0;
  // Serialises concurrent getToken() calls within the run. Not the
  // cross-run single-flight we deliberately did not build — just enough that
  // two awaits inside one run cannot both trigger a fetch.
  let inFlight: Promise<string> | null = null;

  const fetchToken = async (): Promise<string> => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope,
    }).toString();

    const response = await fetchWithRetry({
      url: tokenEndpoint(credentials.tenantId),
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal,
      deadlineAtMs,
    });

    let parsed: TokenResponse;
    try {
      parsed = (await response.json()) as TokenResponse;
    } catch {
      throw new TokenAcquisitionError("response was not JSON");
    }

    const accessToken = parsed.access_token;
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new TokenAcquisitionError("response carried no access_token");
    }

    // Absent or nonsensical expires_in: assume the shortest lifetime
    // Microsoft documents rather than treating the token as long-lived.
    const expiresInSec =
      typeof parsed.expires_in === "number" && parsed.expires_in > 0
        ? parsed.expires_in
        : 300;

    token = accessToken;
    expiresAtMs = now() + expiresInSec * 1000;
    return accessToken;
  };

  return {
    async getToken(): Promise<string> {
      if (token !== null && now() + REFRESH_MARGIN_MS < expiresAtMs) {
        return token;
      }
      if (inFlight !== null) return await inFlight;

      inFlight = fetchToken().finally(() => {
        inFlight = null;
      });
      return await inFlight;
    },
  };
}
