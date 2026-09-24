/**
 * Module-scoped Azure AD token cache keyed by identity, not instance
 * (issue #6087). Per-project BYOC identity (#6088) prevents token leaks.
 */
import {
  AzureCliCredential,
  ManagedIdentityCredential,
  type TokenCredential,
  WorkloadIdentityCredential,
} from "@azure/identity";
import { nowInstant } from "@langwatch/time";

import type { AzureCredentials, AzureTokenAuthMode } from "./azure-blob-credentials.service.ts";

export type TokenModeCredentials = Extract<AzureCredentials, { mode: AzureTokenAuthMode }>;

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
 * Extract AADSTS code from Entra rejection — it's safe to surface and invaluable
 * for operators. Discard SDK message which may quote credentials.
 */
const AADSTS_CODE = /\bAADSTS\d{4,6}\b/;

function extractAadstsCode(error: unknown): string | undefined {
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
  const tenantId = credentials.identity.tenantId ?? "";
  const clientId = credentials.identity.clientId ?? "";
  const audience = audienceFor(credentials);
  return `${authorityHost}|${tenantId}|${clientId}|${audience}`;
}

function buildCredential(credentials: TokenModeCredentials): TokenCredential {
  switch (credentials.mode) {
    case "workloadIdentity":
      return new WorkloadIdentityCredential({
        authorityHost: credentials.authorityHost,
        tenantId: credentials.identity.tenantId,
        clientId: credentials.identity.clientId,
        // Pass the FILE PATH, never file content read by us — kubelet
        // rotates the projected service-account token on disk, and the SDK
        // re-reads this path on every exchange. Reading it once ourselves
        // (e.g. at module load) would authenticate with a stale assertion
        // for the lifetime of the process.
        tokenFilePath: credentials.identity.federatedTokenFile,
      });
    case "managedIdentity":
      return new ManagedIdentityCredential({
        authorityHost: credentials.authorityHost,
        ...(credentials.identity.clientId ? { clientId: credentials.identity.clientId } : {}),
      });
    case "azureCli":
      return new AzureCliCredential();
  }
}

async function exchangeToken(credentials: TokenModeCredentials): Promise<ExchangeResult> {
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
      extractAadstsCode(error),
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

function startExchange(key: string, credentials: TokenModeCredentials): CacheEntry {
  const promise = exchangeToken(credentials).then((result) => {
    // Only record the resolved expiry if we're still the active entry for
    // this key — a later refresh may already have replaced us.
    if (tokenCache.get(key) === entry) {
      entry.resolvedExpiresOnTimestamp = result.expiresOnTimestamp;
    }
    return result;
  });
  const entry: CacheEntry = { promise };
  // Clear the cache on failure so the NEXT call retries instead of
  // replaying a cached rejection forever.
  promise.catch(() => {
    if (tokenCache.get(key) === entry) tokenCache.delete(key);
  });
  tokenCache.set(key, entry);
  return entry;
}

/**
 * Cold-cache callers share one exchange because insertion occurs synchronously
 * before the first `await`.
 */
async function getAzureBlobToken(credentials: TokenModeCredentials): Promise<string> {
  const key = cacheKey(credentials);
  let entry = tokenCache.get(key);

  const isStale =
    entry?.resolvedExpiresOnTimestamp !== undefined &&
    entry.resolvedExpiresOnTimestamp - nowInstant().epochMilliseconds <= REFRESH_SAFETY_MARGIN_MS;

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
function invalidateAzureBlobToken(credentials: TokenModeCredentials): void {
  tokenCache.delete(cacheKey(credentials));
}

/** Test-only: clears every cached token so suites don't leak state across tests. */
function resetAzureTokenCacheForTests(): void {
  tokenCache.clear();
}

export class AzureBlobTokenProviderAdapter {
  private constructor() {}

  static create(): AzureBlobTokenProviderAdapter {
    return new AzureBlobTokenProviderAdapter();
  }

  static getAzureBlobToken = getAzureBlobToken;
  static invalidateAzureBlobToken = invalidateAzureBlobToken;
  static resetAzureTokenCacheForTests = resetAzureTokenCacheForTests;
}
