/**
 * The Azure credential shapes the migration task and the blob repository sign with, and the
 * transport guards a token-mode credential must pass. Resolving a deployment's own settings
 * is the process-stores object-storage member's.
 */

/**
 * Resolved Azure credentials for exactly one auth mode — a discriminated union to catch
 * missing cases at compile time instead of failing at runtime.
 */
export type AzureCredentials =
  | {
      mode: "sharedKey";
      accountName: string;
      accountKey: string;
      endpointBaseUrl?: string | undefined;
    }
  | {
      mode: "workloadIdentity" | "managedIdentity" | "azureCli";
      accountName: string;
      endpointBaseUrl?: string | undefined;
      authorityHost?: string | undefined;
      audience?: string | undefined;
      /**
       * The identity the token exchange runs as, carried on the credential rather than read from
       * process globals by the token provider. It is also part of the token cache key, which is
       * what keeps two identities from ever sharing one cached bearer token.
       */
      identity: AzureInjectedIdentity;
    };

/**
 * The federated identity the process platform injected, as the composition
 * root that read it hands it in.
 */
export type AzureInjectedIdentity = Readonly<{
  tenantId?: string | undefined;
  clientId?: string | undefined;
  federatedTokenFile?: string | undefined;
}>;

export type AzureTokenAuthMode = Extract<
  AzureCredentials,
  { mode: "workloadIdentity" | "managedIdentity" | "azureCli" }
>["mode"];

/**
 * Thrown when Azure Blob configuration is incomplete or contradictory. Fails loud,
 * naming exactly what's wrong.
 */
export class AzureBackendMisconfiguredError extends Error {
  readonly missingVariables: string[];

  constructor(message: string, missingVariables: string[] = []) {
    super(message);
    this.name = "AzureBackendMisconfiguredError";
    this.missingVariables = missingVariables;
  }
}

const PUBLIC_CLOUD_SUFFIX = ".blob.core.windows.net";

/**
 * Test-only escape hatch for plaintext HTTP endpoints in token auth mode.
 * Never true outside tests; never transmitted plaintext in production.
 */
const ALLOW_INSECURE_TOKEN_ENDPOINT_ENV = "AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS";

/** Loopback / emulator hosts (Azurite) are local dev, not a "sovereign cloud". */
function isLocalEmulatorHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function assertHttpsEndpoint(endpointBaseUrl: string | undefined, allowInsecure: boolean): void {
  if (!endpointBaseUrl) return;
  let url: URL;
  try {
    url = new URL(endpointBaseUrl);
  } catch {
    // An unparsable endpoint surfaces a clearer error from the driver's own
    // URL construction; this guard only concerns the transport scheme.
    return;
  }
  if (url.protocol === "https:") return;
  // Enforced in code, not by the comment on the constant: the composition
  // root refuses the escape hatch outright in production, so setting it on a
  // real deployment cannot put a bearer token on the wire in plaintext no
  // matter who sets it.
  if (allowInsecure) return;

  throw new AzureBackendMisconfiguredError(
    `AZURE_BLOB_ENDPOINT ("${endpointBaseUrl}") must use https in a token-based ` +
      "AZURE_BLOB_AUTH_MODE — a bearer token must never be sent over a " +
      `plaintext connection. Set ${ALLOW_INSECURE_TOKEN_ENDPOINT_ENV}=1 only for ` +
      "local emulator tests, never in a real deployment.",
  );
}

function assertSovereignAuthority({
  endpointBaseUrl,
  authorityHost,
}: {
  endpointBaseUrl: string | undefined;
  authorityHost: string | undefined;
}): void {
  if (!endpointBaseUrl) return;
  let hostname: string;
  try {
    hostname = new URL(endpointBaseUrl).hostname;
  } catch {
    return;
  }
  const isPublicCloudHost = hostname.toLowerCase().endsWith(PUBLIC_CLOUD_SUFFIX);
  if (isPublicCloudHost) return;
  if (isLocalEmulatorHost(hostname)) return;
  if (authorityHost) return;

  throw new AzureBackendMisconfiguredError(
    `AZURE_BLOB_ENDPOINT ("${endpointBaseUrl}") does not address the public Azure ` +
      "cloud. A sovereign or non-public-cloud storage endpoint requires " +
      "AZURE_BLOB_AUTHORITY_HOST to be set so tokens are requested from the " +
      "matching identity authority, not the public-cloud default.",
  );
}

/**
 * Transport guards every token-mode credential must pass: no plaintext for bearer
 * tokens, sovereign endpoints must name authority host.
 */
type AzureTransportSafetyInput = {
  endpointBaseUrl: string | undefined;
  authorityHost: string | undefined;
  allowInsecureTokenEndpointForTests?: boolean | undefined;
};

function assertTokenModeTransportSafety({
  endpointBaseUrl,
  authorityHost,
  allowInsecureTokenEndpointForTests = false,
}: AzureTransportSafetyInput): void {
  assertHttpsEndpoint(endpointBaseUrl, allowInsecureTokenEndpointForTests);
  assertSovereignAuthority({ endpointBaseUrl, authorityHost });
}

/** The transport guards a migration run shares with the application's own credentials. */
export class AzureBlobCredentialsService {
  static create(): AzureBlobCredentialsService {
    return new AzureBlobCredentialsService();
  }

  private constructor() {}

  assertTokenModeTransportSafety(input: AzureTransportSafetyInput): void {
    assertTokenModeTransportSafety(input);
  }
}
