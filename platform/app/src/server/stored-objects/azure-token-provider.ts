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
 * `${authorityHost}|${tenantId}|${clientId}|${audience}` so it is already
 * shaped for that future without a rewrite.
 */
import {
  AzureCliCredential,
  ManagedIdentityCredential,
  WorkloadIdentityCredential,
  type TokenCredential,
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
export class AzureTokenExchangeError extends Error {
  constructor(reason?: string) {
    super(
      `Azure Blob token exchange failed${reason ? ` (${reason})` : ""}: the ` +
        "identity provider rejected the credential request.",
    );
    this.name = "AzureTokenExchangeError";
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
    throw new AzureTokenExchangeError(
      error instanceof Error ? error.name : undefined,
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
