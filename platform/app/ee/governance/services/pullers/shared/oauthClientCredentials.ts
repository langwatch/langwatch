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

import { fetchWithRetry, HttpResponseError } from "./httpRetry";

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
 * unusable. Carries the status and, when the endpoint supplied them, the
 * numeric AADSTS codes — never the response text and never the request body:
 * the request that produced it had the client secret in its form body, and an
 * error that quotes the exchange is the most likely way a secret reaches a log.
 *
 * The codes matter because the status alone cannot say which of the four
 * setup mistakes happened, and all four answer 400:
 *
 *   7000215  wrong client secret
 *   700016   the app id is not in this tenant
 *   90002    the tenant id does not exist
 *   500011   the scope's resource principal is not in this tenant — for
 *            `https://manage.office.com/.default` that means the Office 365
 *            Management APIs service principal was never provisioned
 *
 * Without them, "the token endpoint answered 400" is where the investigation
 * both starts and stops.
 */
export class TokenAcquisitionError extends Error {
  readonly errorCodes: number[];

  constructor(reason: string, errorCodes: number[] = []) {
    super(
      `OAuth client-credentials token request failed: ${reason}` +
        (errorCodes.length > 0 ? ` (AADSTS ${errorCodes.join(", ")})` : ""),
    );
    this.name = "TokenAcquisitionError";
    this.errorCodes = errorCodes;
  }
}

/**
 * The `error_codes` array from an Azure AD token-endpoint failure.
 *
 * Numbers only, by construction: `error_description` is free text the service
 * composes, and this module's rule is that nothing from that exchange is
 * quoted. An unparseable or differently-shaped body yields an empty list
 * rather than throwing — a failure to explain a failure must not replace it.
 */
function aadErrorCodesFrom(bodyText: string): number[] {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== "object" || parsed === null) return [];
    const codes = (parsed as { error_codes?: unknown }).error_codes;
    if (!Array.isArray(codes)) return [];
    return codes.filter((code): code is number => typeof code === "number");
  } catch {
    return [];
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
    }).catch((error: unknown) => {
      // A client status is the endpoint refusing us — a wrong secret, a wrong
      // tenant, a scope we were not granted. Carry the status and the numeric
      // AADSTS codes, nothing else: the request that produced this had the
      // client secret in its form body, and HttpResponseError keeps the
      // response body, which is what TokenAcquisitionError must not carry.
      //
      // Everything else stays as it is: deadline, abort, transport failure
      // and exhausted 5xx retries are not the endpoint refusing us, and
      // flattening them into one type would lose the distinction a caller
      // needs to decide whether retrying is worth anything.
      if (error instanceof HttpResponseError && error.status < 500) {
        throw new TokenAcquisitionError(
          `the token endpoint answered ${error.status}`,
          aadErrorCodesFrom(error.bodyText),
        );
      }
      throw error;
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
