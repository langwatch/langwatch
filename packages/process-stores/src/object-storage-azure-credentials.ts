/**
 * Azure Blob credentials for exactly one auth mode, refused by name when the
 * `AZURE_BLOB_*` block is incomplete or contradictory, and the bearer tokens
 * a token mode exchanges its identity for, cached per identity.
 */
import {
  AzureCliCredential,
  ManagedIdentityCredential,
  WorkloadIdentityCredential,
  type TokenCredential,
} from "@azure/identity";

import type { ObjectStorageAzureConfig, ObjectStorageAzureIdentity } from "./config.ts";
import type { Clock } from "./members.ts";

const TOKEN_MODES = ["workloadIdentity", "managedIdentity", "azureCli"] as const;
type AzureTokenMode = (typeof TOKEN_MODES)[number];

export type AzureCredentials =
  | Readonly<{
      mode: "sharedKey";
      accountName: string;
      accountKey: string;
      container: string;
      endpoint: string;
    }>
  | Readonly<{
      mode: AzureTokenMode;
      accountName: string;
      container: string;
      endpoint: string;
      authorityHost: string | undefined;
      audience: string;
      identity: ObjectStorageAzureIdentity;
    }>;

/** Azure Blob configuration that is incomplete or contradictory, naming what is wrong. */
export class AzureBackendMisconfiguredError extends Error {
  constructor(
    message: string,
    readonly missingVariables: readonly string[] = [],
  ) {
    super(message);
    this.name = "AzureBackendMisconfiguredError";
  }
}

/** The identity provider refused the exchange. Carries its AADSTS code, never credentials. */
export class AzureTokenExchangeError extends Error {
  constructor(
    reason: string | undefined,
    readonly aadstsCode: string | undefined,
  ) {
    const mismatch = aadstsCode === "AADSTS70021" || aadstsCode === "AADSTS700213";
    const remedy = mismatch
      ? " The federated identity credential does not match this pod's token: check its issuer " +
        '(trailing slash included), its subject and its audience "api://AzureADTokenExchange".'
      : "";
    super(
      `Azure Blob token exchange failed${reason ? ` (${reason})` : ""}` +
        `${aadstsCode ? ` [${aadstsCode}]` : ""}: the identity provider refused the request.${remedy}`,
    );
    this.name = "AzureTokenExchangeError";
  }
}

const PUBLIC_CLOUD_SUFFIX = ".blob.core.windows.net";
const PUBLIC_CLOUD_AUDIENCE = "https://storage.azure.com";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const AADSTS_CODE = /\bAADSTS\d{4,6}\b/;

function isTokenMode(mode: string): mode is AzureTokenMode {
  return TOKEN_MODES.some((tokenMode) => tokenMode === mode);
}

function hostnameOf(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** A bearer token never travels in plaintext, and a sovereign cloud names its own authority. */
function assertTokenTransport(options: {
  endpoint: string;
  authorityHost: string | undefined;
  allowInsecure: boolean;
}): void {
  const { endpoint, authorityHost, allowInsecure } = options;
  if (!endpoint.startsWith("https:") && !allowInsecure) {
    throw new AzureBackendMisconfiguredError(
      `AZURE_BLOB_ENDPOINT ("${endpoint}") must use https in a token-based AZURE_BLOB_AUTH_MODE: ` +
        "a bearer token is never sent over a plaintext connection.",
    );
  }
  const hostname = hostnameOf(endpoint) ?? "";
  const isPublicOrLocal =
    hostname.endsWith(PUBLIC_CLOUD_SUFFIX) || hostname === "127.0.0.1" || hostname === "localhost";
  if (!isPublicOrLocal && !authorityHost) {
    throw new AzureBackendMisconfiguredError(
      `AZURE_BLOB_ENDPOINT ("${endpoint}") is not the public Azure cloud, so ` +
        "AZURE_BLOB_AUTHORITY_HOST must name the identity authority that issues its tokens.",
    );
  }
}

/** The webhook injects all three; any absent means it never mutated this pod. */
function assertWorkloadIdentity(identity: ObjectStorageAzureIdentity): void {
  const missing = [
    ["AZURE_CLIENT_ID", identity.clientId],
    ["AZURE_TENANT_ID", identity.tenantId],
    ["AZURE_FEDERATED_TOKEN_FILE", identity.federatedTokenFile],
  ].flatMap(([name, value]) => (value?.trim() ? [] : [name ?? ""]));
  if (missing.length === 0) return;
  throw new AzureBackendMisconfiguredError(
    `AZURE_BLOB_AUTH_MODE=workloadIdentity but ${missing.join(", ")} are absent: the AKS ` +
      "workload-identity webhook never mutated this pod. Check the pod label " +
      '`azure.workload.identity/use: "true"` and the ServiceAccount client-id annotation.',
    missing,
  );
}

export function resolveAzureCredentials(config: ObjectStorageAzureConfig): AzureCredentials {
  const mode = config.authMode?.trim() || "sharedKey";
  if (mode !== "sharedKey" && !isTokenMode(mode)) {
    throw new AzureBackendMisconfiguredError(`Unsupported AZURE_BLOB_AUTH_MODE "${mode}".`);
  }
  const accountName = config.accountName?.trim() ?? "";
  const accountKey = config.accountKey?.trim() ?? "";
  const container = config.container?.trim() ?? "";
  const endpoint = (
    config.endpoint?.trim() || `https://${accountName}${PUBLIC_CLOUD_SUFFIX}`
  ).replace(/\/+$/, "");

  if (mode !== "sharedKey" && accountKey) {
    throw new AzureBackendMisconfiguredError(
      `AZURE_BLOB_ACCOUNT_KEY is set alongside AZURE_BLOB_AUTH_MODE=${mode}, which never uses it. ` +
        "Remove AZURE_BLOB_ACCOUNT_KEY so the credential in use is unambiguous.",
    );
  }
  const missing = [
    ...(accountName ? [] : ["AZURE_BLOB_ACCOUNT_NAME"]),
    ...(container ? [] : ["AZURE_BLOB_CONTAINER"]),
    ...(mode === "sharedKey" && !accountKey ? ["AZURE_BLOB_ACCOUNT_KEY"] : []),
  ];
  if (missing.length > 0) {
    throw new AzureBackendMisconfiguredError(
      `AZURE_BLOB_AUTH_MODE=${mode} requires ${missing.join(", ")}. ` +
        "Refusing to fall back to S3 or the local filesystem.",
      missing,
    );
  }
  if (mode === "sharedKey") return { mode, accountName, accountKey, container, endpoint };

  const authorityHost = config.authorityHost?.trim() || undefined;
  assertTokenTransport({
    endpoint,
    authorityHost,
    allowInsecure: config.allowInsecureTokenEndpointForTests ?? false,
  });
  const identity = config.identity ?? {};
  if (mode === "workloadIdentity") assertWorkloadIdentity(identity);
  return {
    mode,
    accountName,
    container,
    endpoint,
    authorityHost,
    audience: config.tokenAudience?.trim() || PUBLIC_CLOUD_AUDIENCE,
    identity,
  };
}

function credentialFor(
  credentials: Extract<AzureCredentials, { mode: AzureTokenMode }>,
): TokenCredential {
  switch (credentials.mode) {
    case "workloadIdentity":
      // The SDK re-reads the file on every exchange, so kubelet's rotation is honoured.
      return new WorkloadIdentityCredential({
        authorityHost: credentials.authorityHost,
        tenantId: credentials.identity.tenantId,
        clientId: credentials.identity.clientId,
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

/** Bearer tokens for one identity: callers share one exchange, refreshed before it lapses. */
export interface AzureTokenSource {
  token(): Promise<string>;
  /** Drops the cached token after a 401, so the next call exchanges again. */
  invalidate(): void;
}

/** The SDK's error names no secrets but may quote a request: keep its name and AADSTS code only. */
function exchangeFailure(error: unknown): AzureTokenExchangeError {
  if (error instanceof AzureTokenExchangeError) return error;
  if (!(error instanceof Error)) return new AzureTokenExchangeError(undefined, undefined);
  return new AzureTokenExchangeError(error.name, AADSTS_CODE.exec(error.message)?.[0]);
}

export function azureTokenSource(options: {
  credentials: Extract<AzureCredentials, { mode: AzureTokenMode }>;
  clock: Clock;
}): AzureTokenSource {
  const { credentials, clock } = options;
  const credential = credentialFor(credentials);
  let pending: Promise<{ token: string }> | undefined;
  let expiresAt: number | undefined;

  const exchange = async () => {
    const accessToken = await credential
      .getToken(`${credentials.audience}/.default`)
      .catch((error: unknown) => {
        pending = undefined;
        throw exchangeFailure(error);
      });
    if (!accessToken) {
      pending = undefined;
      throw new AzureTokenExchangeError("no token returned", undefined);
    }
    expiresAt = accessToken.expiresOnTimestamp;
    return accessToken;
  };

  return {
    async token() {
      const lapsing =
        expiresAt !== undefined && expiresAt - clock.now().getTime() <= REFRESH_MARGIN_MS;
      if (pending === undefined || lapsing) {
        expiresAt = undefined;
        pending = exchange();
      }
      return (await pending).token;
    },
    invalidate() {
      pending = undefined;
      expiresAt = undefined;
    },
  };
}
