/**
 * Module-scoped Azure AD token cache + acquisition for token-based Azure
 * Blob auth modes (issue #6087).
 *
 * Cached at MODULE scope, keyed by identity — NOT per `AzureBlobDriver`
 * instance: `createStorageRegistry` builds a new driver on every request,
 * so an instance-scoped cache would re-exchange a token on every single
 * storage operation. NOT a single unkeyed cache either: once per-project
 * BYOC identity lands (#6088), two projects resolving to different
 * identities must never share a token — an unkeyed cache would leak one
 * tenant's bearer token into another tenant's requests. The key is
 * `${authorityHost}|${tenantId}|${clientId}|${audience}`.
 *
 * Caveat, deliberately recorded rather than papered over: `tenantId` and
 * `clientId` are read from process-global env, because today the platform
 * injects exactly one identity per process. That is correct as shipped —
 * one identity, one cache entry — but it is NOT yet sufficient for #6088.
 * Per-project identities cannot vary a process-global variable, so before
 * that lands, `tenantId`/`clientId` must move onto `AzureCredentials` (the
 * resolver filling them from env today, per-project later) and `mode` must
 * join the key. Until then, do not assume this cache separates tenants.
 */
import {
  AzureCliCredential,
  ManagedIdentityCredential,
  type TokenCredential,
  WorkloadIdentityCredential,
} from "@azure/identity";
import type { AzureCredentials, AzureTokenAuthMode } from "./azure-credentials";

export type TokenModeCredentials = Extract<
  AzureCredentials,
  { mode: AzureTokenAuthMode }
>;

const PUBLIC_CLOUD_AUDIENCE = "https://storage.azure.com";

/**
 * Refresh a token this long before it actually expires, so no in-flight
 * request ever observes an expired token mid-flight.
 */
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

type ExchangeResult = { token: string; expiresOnTimestamp: number };

type CacheEntry = {
  promise: Promise<ExchangeResult>;
  /** Set once `promise` resolves, so staleness can be checked synchronously. */
  resolvedExpiresOnTimestamp?: number;
};

const tokenCache = new Map<string, CacheEntry>();

/** Thrown when the identity provider rejects a token request. Never carries credential material. */
/**
 * Entra returns a machine-readable AADSTS code on every rejection, and it is
 * the single most useful line an operator can have — AADSTS70021 ("no matching
 * federated identity record") means the federated credential's issuer, subject
 * or audience does not match the token the cluster presented, which is the most
 * common workload-identity misconfiguration by a wide margin.
 *
 * The code is an error identifier, not credential material, so it is safe to
 * surface. The surrounding SDK message is not: it can quote the request and
 * the assertion. We extract the code and discard everything else.
 */
const AADSTS_CODE = /\bAADSTS\d{4,6}\b/;

function aadstsCodeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return AADSTS_CODE.exec(error.message)?.[0];
}

export class AzureTokenExchangeError extends Error {
  /** The AADSTS code, when Entra supplied one. */
  readonly aadstsCode?: string;

  constructor(reason?: string, aadstsCode?: string) {
    const remedy =
      aadstsCode === "AADSTS70021" || aadstsCode === "AADSTS700213"
        ? " The federated identity credential does not match the token this pod " +
          "presented: check its issuer (including the trailing slash), its " +
          'subject ("system:serviceaccount:NAMESPACE:SERVICEACCOUNT", ' +
          'case-exact), and that its audience is "api://AzureADTokenExchange".'
        : "";
    super(
      `Azure Blob token exchange failed${reason ? ` (${reason})` : ""}` +
        `${aadstsCode ? ` [${aadstsCode}]` : ""}: the identity provider ` +
        `rejected the credential request.${remedy}`,
    );
    this.name = "AzureTokenExchangeError";
    this.aadstsCode = aadstsCode;
  }
}

function audienceFor(credentials: TokenModeCredentials): string {
  return credentials.audience ?? PUBLIC_CLOUD_AUDIENCE;
}

function scopeFor(credentials: TokenModeCredentials): string {
  return `${audienceFor(credentials)}/.default`;
}

function cacheKey(credentials: TokenModeCredentials): string {
  const authorityHost = credentials.authorityHost ?? "";
  const tenantId = process.env.AZURE_TENANT_ID ?? "";
  const clientId = process.env.AZURE_CLIENT_ID ?? "";
  const audience = audienceFor(credentials);
  return `${authorityHost}|${tenantId}|${clientId}|${audience}`;
}

function buildCredential(credentials: TokenModeCredentials): TokenCredential {
  switch (credentials.mode) {
    case "workloadIdentity":
      return new WorkloadIdentityCredential({
        authorityHost: credentials.authorityHost,
        tenantId: process.env.AZURE_TENANT_ID,
        clientId: process.env.AZURE_CLIENT_ID,
        // Pass the FILE PATH, never file content read by us — kubelet
        // rotates the projected service-account token on disk, and the SDK
        // re-reads this path on every exchange. Reading it once ourselves
        // (e.g. at module load) would authenticate with a stale assertion
        // for the lifetime of the process.
        tokenFilePath: process.env.AZURE_FEDERATED_TOKEN_FILE,
      });
    case "managedIdentity":
      return new ManagedIdentityCredential({
        authorityHost: credentials.authorityHost,
        ...(process.env.AZURE_CLIENT_ID
          ? { clientId: process.env.AZURE_CLIENT_ID }
          : {}),
      });
    case "azureCli":
      return new AzureCliCredential();
  }
}

async function exchangeToken(
  credentials: TokenModeCredentials,
): Promise<ExchangeResult> {
  const credential = buildCredential(credentials);
  let accessToken;
  try {
    accessToken = await credential.getToken(scopeFor(credentials));
  } catch (error: unknown) {
    // Identify the failure as a token exchange only — the underlying SDK
    // error can embed request/assertion details we never want to surface.
    // The AADSTS code is the exception: an identifier, not a secret, and the
    // one thing that tells an operator which knob is wrong.
    throw new AzureTokenExchangeError(
      error instanceof Error ? error.name : undefined,
      aadstsCodeOf(error),
    );
  }
  if (!accessToken) {
    throw new AzureTokenExchangeError("no token returned");
  }
  return {
    token: accessToken.token,
    expiresOnTimestamp: accessToken.expiresOnTimestamp,
  };
}

function startExchange(
  key: string,
  credentials: TokenModeCredentials,
): CacheEntry {
  const entry: CacheEntry = {
    promise: undefined as unknown as Promise<ExchangeResult>,
  };
  const promise = exchangeToken(credentials).then((result) => {
    // Only record the resolved expiry if we're still the active entry for
    // this key — a later refresh may already have replaced us.
    if (tokenCache.get(key) === entry) {
      entry.resolvedExpiresOnTimestamp = result.expiresOnTimestamp;
    }
    return result;
  });
  entry.promise = promise;
  // Clear the cache on failure so the NEXT call retries instead of
  // replaying a cached rejection forever.
  promise.catch(() => {
    if (tokenCache.get(key) === entry) tokenCache.delete(key);
  });
  tokenCache.set(key, entry);
  return entry;
}

/**
 * Returns a valid bearer token for the given identity, exchanging one only
 * when the cache is cold or the cached token is within the refresh safety
 * margin of expiring. Concurrent callers landing on a cold cache share the
 * SAME in-flight exchange promise — the check-and-set below happens
 * synchronously (no `await` in between), so N callers dispatched together
 * always observe exactly one exchange, never one per caller.
 */
export async function getAzureBlobToken(
  credentials: TokenModeCredentials,
): Promise<string> {
  const key = cacheKey(credentials);
  let entry = tokenCache.get(key);

  const isStale =
    entry?.resolvedExpiresOnTimestamp !== undefined &&
    entry.resolvedExpiresOnTimestamp - Date.now() <= REFRESH_SAFETY_MARGIN_MS;

  if (!entry || isStale) {
    entry = startExchange(key, credentials);
  }

  const result = await entry.promise;
  return result.token;
}

/**
 * Evicts the cached token for this identity — called by the driver after a
 * 401 so the retry acquires a fresh token instead of replaying the one that
 * was just rejected.
 */
export function invalidateAzureBlobToken(
  credentials: TokenModeCredentials,
): void {
  tokenCache.delete(cacheKey(credentials));
}

/** Test-only: clears every cached token so suites don't leak state across tests. */
export function resetAzureTokenCacheForTests(): void {
  tokenCache.clear();
}
