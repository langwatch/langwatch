/**
 * Single source of truth for Azure Blob credentials (issue #6087, follow-up
 * to #4133 / AC37).
 *
 * Before this module existed, three sites decided independently what
 * "Azure is configured" meant: the destination resolver, the read-driver
 * registration in the stored-objects factory, and the dataset storage
 * implementation. Two of them would crash on `Buffer.from(undefined)` the
 * moment a token-based auth mode was introduced, and nothing guaranteed the
 * destination resolver and the driver registration agreed on whether Azure
 * was usable. Every consumer calls `resolveAzureCredentials()` instead of
 * deciding for itself.
 *
 * The values arrive as a record rather than being read here: this package
 * reads no environment. The composition root that owns the process's one
 * environment reader passes what it read, including the two knobs that used
 * to be consulted through `process.env` from inside these guards — the
 * deployment's selected backend and the test-only plaintext escape hatch —
 * so a guard cannot disagree with the configuration the process actually
 * booted on.
 *
 * See specs/features/scenarios/azure-blob-workload-identity.feature.
 */

/**
 * Resolved Azure credentials for exactly one auth mode. A discriminated
 * union — deliberately, so a construction site that only destructures
 * `accountKey` fails to compile against the token-mode arms instead of
 * reading `undefined` at runtime (AC "Adding an auth mode forces every
 * Azure credential construction site to be revisited").
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
       * The identity the token exchange runs as, carried on the credential
       * rather than read from process globals by the token provider. It is
       * also part of the token cache key, which is what keeps two identities
       * from ever sharing one cached bearer token.
       */
      identity: AzureInjectedIdentity;
    };

/**
 * The federated identity the process platform injected, as the composition
 * root that read it hands it in.
 *
 * These are Microsoft's own variable names (AZURE_TENANT_ID, AZURE_CLIENT_ID,
 * AZURE_FEDERATED_TOKEN_FILE), written into the pod by the AKS
 * azure-workload-identity webhook rather than by an operator. The process's
 * environment reader is what names them; this module only receives them.
 */
export type AzureInjectedIdentity = Readonly<{
  tenantId?: string | undefined;
  clientId?: string | undefined;
  federatedTokenFile?: string | undefined;
}>;

/**
 * The `AZURE_BLOB_*` block as this deployment was configured, already read.
 *
 * `backend` is the deployment's stored-object selection, which the dead-config
 * guard compares an auth mode against. `allowInsecureTokenEndpointForTests`
 * is the plaintext escape hatch: the composition root decides whether this
 * process may set it, and a production process must answer `false`.
 */
export type AzureBlobCredentialsConfig = Readonly<{
  authMode: string | undefined;
  accountName: string | undefined;
  accountKey: string | undefined;
  container: string | undefined;
  endpoint: string | undefined;
  authorityHost: string | undefined;
  tokenAudience: string | undefined;
  backend: "s3" | "azure" | undefined;
  allowInsecureTokenEndpointForTests?: boolean | undefined;
}>;

export type AzureTokenAuthMode = Extract<
  AzureCredentials,
  { mode: "workloadIdentity" | "managedIdentity" | "azureCli" }
>["mode"];

/**
 * Thrown whenever Azure Blob configuration is incomplete or contradictory —
 * a required var is missing, a shared key is set alongside a token mode, an
 * auth mode is set without the azure backend selected, a token-based
 * endpoint is not https, a sovereign endpoint has no matching authority
 * host, or the platform never injected the AKS workload-identity values.
 * Fails loud, naming exactly what's wrong — no silent fallback to S3, the
 * local filesystem, or a different auth mode than the operator chose.
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
 * The name of the test-only escape hatch that allows a plaintext HTTP endpoint
 * in a token-based auth mode (e.g. driving a local emulator without TLS). A
 * bearer token must never be transmitted over plaintext in any real
 * deployment, so the composition root must never resolve it to `true` outside
 * a test process. Named here only so the refusal below can tell an operator
 * which knob they reached for.
 */
export const ALLOW_INSECURE_TOKEN_ENDPOINT_ENV =
  "AZURE_BLOB_ALLOW_INSECURE_TOKEN_ENDPOINT_FOR_TESTS";

const TOKEN_MODES = new Set<AzureTokenAuthMode>([
  "workloadIdentity",
  "managedIdentity",
  "azureCli",
]);

function isTokenMode(mode: string): mode is AzureTokenAuthMode {
  return TOKEN_MODES.has(mode as AzureTokenAuthMode);
}

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
  if (hostname.toLowerCase().endsWith(PUBLIC_CLOUD_SUFFIX)) return;
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
 * `workloadIdentity` relies entirely on values the AKS azure-workload-identity
 * admission webhook injects into the pod (AZURE_CLIENT_ID, AZURE_TENANT_ID,
 * AZURE_FEDERATED_TOKEN_FILE — and optionally AZURE_AUTHORITY_HOST). These are
 * Microsoft's own standard variable names, owned by the webhook rather than by
 * our own schema, and the composition root reads them under those names. Their
 * absence means the webhook never mutated this pod — never that the operator
 * forgot to set them by hand, so the error must not suggest that.
 */
function assertWorkloadIdentityInjectedValues(identity: AzureInjectedIdentity): void {
  const clientId = identity.clientId;
  const tenantId = identity.tenantId;
  const federatedTokenFile = identity.federatedTokenFile;

  const missing: string[] = [];
  if (!clientId?.trim()) missing.push("AZURE_CLIENT_ID");
  if (!tenantId?.trim()) missing.push("AZURE_TENANT_ID");
  if (!federatedTokenFile?.trim()) {
    missing.push("AZURE_FEDERATED_TOKEN_FILE");
  }
  if (missing.length === 0) return;

  throw new AzureBackendMisconfiguredError(
    "AZURE_BLOB_AUTH_MODE=workloadIdentity but the platform-injected federated " +
      `identity values (${missing.join(", ")}) are absent. This means the AKS ` +
      "workload-identity admission webhook never mutated this pod. Check: " +
      'the pod carries the label `azure.workload.identity/use: "true"`, the ' +
      "ServiceAccount carries the `azure.workload.identity/client-id` " +
      "annotation, and the azure-workload-identity webhook is installed on the " +
      "cluster. Do not set these variables by hand — the webhook injects them " +
      "automatically when all three conditions are met.",
    missing,
  );
}

/**
 * Dead-config guard, for WRITE resolution only. Reads are deliberately
 * exempt (`purpose: "read"`): an operator migrating OFF Azure flips the
 * backend toggle to s3 and leaves the AZURE_BLOB_* values in place so the
 * objects already written stay readable — the mirror image of the
 * legacyS3ReadBucket path we document for the S3->Azure direction.
 * Refusing to build a read driver there would strand every historical
 * azure-blob:// object behind an "unregistered scheme" error.
 */
function assertTokenModeIsSelected({
  purpose,
  mode,
  backend,
}: {
  purpose: "read" | "write";
  mode: AzureCredentials["mode"];
  backend: "s3" | "azure" | undefined;
}): void {
  if (purpose === "write" && isTokenMode(mode) && backend !== "azure") {
    throw new AzureBackendMisconfiguredError(
      `AZURE_BLOB_AUTH_MODE=${mode} has no effect without STORED_OBJECTS_BACKEND=azure. ` +
        "Set STORED_OBJECTS_BACKEND=azure to use it, or unset AZURE_BLOB_AUTH_MODE.",
    );
  }
}

/**
 * A shared key alongside a token mode is refused rather than ignored: silently
 * dropping it leaves the operator guessing which credential is actually in use.
 */
function assertNoRedundantAccountKey({
  mode,
  accountKey,
}: {
  mode: AzureCredentials["mode"];
  accountKey: string | undefined;
}): void {
  if (isTokenMode(mode) && accountKey) {
    throw new AzureBackendMisconfiguredError(
      `AZURE_BLOB_ACCOUNT_KEY is set alongside AZURE_BLOB_AUTH_MODE=${mode}. A ` +
        "token-based mode never uses the shared key — it would be silently " +
        "ignored, leaving the operator guessing which credential is actually " +
        "in use. Remove AZURE_BLOB_ACCOUNT_KEY.",
    );
  }
}

/**
 * Names every missing required variable at once, rather than one per retry.
 *
 * AZURE_BLOB_CONTAINER is required for WRITES only. It names where new objects
 * go, and reads never consult it — an `azure-blob://{account}/{container}/{key}`
 * URI already carries the container it was written to. Requiring it to build a
 * read driver stranded exactly the migration this resolver's `purpose: "read"`
 * arm exists to serve: an operator who moves writes back to S3 and drops the
 * now-unused container variable would find every historical azure-blob:// object
 * failing with "unregistered scheme".
 */
function assertRequiredVariablesPresent({
  purpose,
  mode,
  accountName,
  container,
  accountKey,
}: {
  purpose: "read" | "write";
  mode: AzureCredentials["mode"];
  accountName: string | undefined;
  container: string | undefined;
  accountKey: string | undefined;
}): void {
  const missingVariables: string[] = [];
  if (!accountName) missingVariables.push("AZURE_BLOB_ACCOUNT_NAME");
  if (purpose === "write" && !container) {
    missingVariables.push("AZURE_BLOB_CONTAINER");
  }
  if (mode === "sharedKey" && !accountKey) {
    missingVariables.push("AZURE_BLOB_ACCOUNT_KEY");
  }

  if (missingVariables.length > 0) {
    throw new AzureBackendMisconfiguredError(
      `AZURE_BLOB_AUTH_MODE=${mode} requires ${missingVariables.join(", ")} to be set. ` +
        "Refusing to silently fall back to S3 or the local filesystem.",
      missingVariables,
    );
  }
}

/**
 * The two transport guards every token-mode credential must pass, exported as
 * one seam so ALL construction sites share them: a bearer token must never
 * travel a plaintext connection, and a non-public-cloud endpoint must name
 * the identity authority its tokens come from. The migration task builds its
 * credentials from its own OBJECT_STORAGE_MIGRATION_* namespace rather than
 * through `resolveAzureCredentials`, and bypassing these guards there would
 * let a migration run leak bearer tokens the app itself refuses to.
 */
export function assertTokenModeTransportSafety({
  endpointBaseUrl,
  authorityHost,
  allowInsecureTokenEndpointForTests = false,
}: {
  endpointBaseUrl: string | undefined;
  authorityHost: string | undefined;
  allowInsecureTokenEndpointForTests?: boolean | undefined;
}): void {
  assertHttpsEndpoint(endpointBaseUrl, allowInsecureTokenEndpointForTests);
  assertSovereignAuthority({ endpointBaseUrl, authorityHost });
}

/**
 * Resolves Azure Blob credentials for whichever auth mode is configured, or
 * throws `AzureBackendMisconfiguredError` naming exactly what's wrong.
 *
 * `purpose` distinguishes "which destination do new writes go to" from "can we
 * still read what was written before". They are not symmetric: a deployment can
 * legitimately need the second without the first, so the read arm skips both
 * the dead-config guard and the container requirement.
 *
 * The container is never part of `AzureCredentials` — a credential describes
 * how to authenticate to a storage ACCOUNT, not which container within it a
 * caller addresses. A caller that needs one reads `config.container` itself,
 * and may only assume it is present when it resolved with the default
 * `purpose: "write"`, which is what validates it.
 */
export function resolveAzureCredentials({
  config,
  purpose = "write",
  identity = {},
}: {
  /** The `AZURE_BLOB_*` block, as the process's environment reader read it. */
  config: AzureBlobCredentialsConfig;
  purpose?: "read" | "write";
  /** The platform-injected federated identity, as the composition root read it. */
  identity?: AzureInjectedIdentity;
}): AzureCredentials {
  // Pinned rather than inferred, which is what makes the exhaustiveness check
  // at the bottom of this function real: against a widened string it would
  // silently pass.
  const mode: AzureCredentials["mode"] =
    (config.authMode as AzureCredentials["mode"] | undefined) ?? "sharedKey";

  assertTokenModeIsSelected({ purpose, mode, backend: config.backend });

  const accountName = config.accountName?.trim();
  const accountKey = config.accountKey?.trim();
  const container = config.container?.trim();
  const endpointBaseUrl = config.endpoint?.trim() || undefined;
  const authorityHost = config.authorityHost?.trim() || undefined;
  const audience = config.tokenAudience?.trim() || undefined;

  assertNoRedundantAccountKey({ mode, accountKey });
  assertRequiredVariablesPresent({
    purpose,
    mode,
    accountName,
    container,
    accountKey,
  });

  if (mode === "sharedKey") {
    return {
      mode: "sharedKey",
      accountName: accountName!,
      accountKey: accountKey!,
      endpointBaseUrl,
    };
  }

  assertTokenModeTransportSafety({
    endpointBaseUrl,
    authorityHost,
    allowInsecureTokenEndpointForTests: config.allowInsecureTokenEndpointForTests ?? false,
  });

  if (mode === "workloadIdentity") {
    assertWorkloadIdentityInjectedValues(identity);
  }

  switch (mode) {
    case "workloadIdentity":
    case "managedIdentity":
    case "azureCli":
      return {
        mode,
        accountName: accountName!,
        endpointBaseUrl,
        authorityHost,
        audience,
        identity,
      };
    default: {
      // Exhaustiveness check: a fifth AZURE_BLOB_AUTH_MODE value added to the
      // configuration schema without a matching arm here fails to compile —
      // `mode` would no longer be assignable to `never`.
      const unreachable: never = mode;
      throw new AzureBackendMisconfiguredError(
        `Unsupported AZURE_BLOB_AUTH_MODE "${String(unreachable)}".`,
      );
    }
  }
}
