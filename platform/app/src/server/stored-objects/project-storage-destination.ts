/**
 * One place that decides where a project's externalized bytes live.
 *
 * `resolveProjectStorageDestination(projectId)` is the single source of
 * truth for the precedence used by every byte-writing path:
 *
 *   1. BYOC: the per-project private dataplane bucket from
 *      `getS3ConfigForProject`. Tenant-owned; never silently bypassed.
 *   2. Azure: `env.STORED_OBJECTS_BACKEND === "azure"`, an explicit
 *      operator toggle (issue #4133). AZURE_BLOB_* env presence alone
 *      never selects this branch — only the toggle does; implicit
 *      inference was rejected because deployment behavior must not
 *      depend on which env vars happen to be set. Beats the global S3
 *      bucket (an explicit choice beats a default) but never a BYOC
 *      bucket (a tenant-owned bucket is never silently bypassed).
 *   3. Global S3: `env.S3_BUCKET_NAME`, when set and non-empty.
 *   4. Local filesystem: `env.LANGWATCH_LOCAL_STORAGE_PATH` (or a
 *      documented default). Single-replica only — fine for small
 *      self-host / hobbyist / air-gapped / pre-pilot installs, but
 *      operators of multi-pod deployments must configure S3 (the
 *      chart's `replicaCount > 1` + `localFilesystem.enabled`
 *      combination hard-fails).
 *
 * Previously the precedence was encoded twice: once in
 * `defaultMintStorageUri` (stored-objects.service.ts) for scenario
 * media, and once in `createS3Client` (storage.ts) for dataset uploads.
 * Two copies of the BYOC → env → fallback chain meant either site
 * could silently drift from the other; principles + hygiene + security
 * + uncle-bob + fowler all flagged this on the issue-4053 review.
 *
 * A transient DB error inside `getS3ConfigForProject` propagates out of
 * this function rather than degrading to the global bucket. Falling
 * back to the global bucket on transient errors would leak a BYOC
 * tenant's bytes into the wrong account on the next retry; raising
 * forces the caller (PUT path) to fail loud and retry the whole
 * operation against the correct destination.
 */
import { env } from "~/env.mjs";
import { getS3ConfigForProject } from "~/server/dataplane-s3";
import { resolveAzureCredentials } from "./azure-credentials";

export type ProjectStorageDestination =
  | { kind: "s3"; bucket: string }
  | { kind: "file"; root: string }
  | { kind: "azure"; accountName: string; container: string };

/**
 * Default local filesystem root used when neither a BYOC bucket nor
 * `S3_BUCKET_NAME` is configured. Matches the chart's
 * `app.storedObjects.localFilesystem.path` default and the
 * `.env.example` comment.
 */
const DEFAULT_LOCAL_FS_ROOT = "/var/lib/langwatch/objects";

/**
 * Resolves the azure destination from env, or throws
 * `AzureBackendMisconfiguredError` (from `azure-credentials.ts` — the one
 * place that decides whether Azure config is complete, for every auth
 * mode) naming every missing/contradictory var. Called only once
 * `env.STORED_OBJECTS_BACKEND === "azure"` has already been checked by the
 * caller.
 */
function resolveAzureDestination(): ProjectStorageDestination {
  // The default `purpose: "write"` is what makes the assertion below sound:
  // only the write arm requires AZURE_BLOB_CONTAINER, because only a write
  // needs to be told where to go. Resolving with `purpose: "read"` here would
  // leave the container unvalidated and this `!` unfounded.
  const credentials = resolveAzureCredentials({ purpose: "write" });
  // Validated above, though never carried on the credential itself — that
  // describes how to authenticate to the account, not which container a caller
  // addresses within it.
  const container = env.AZURE_BLOB_CONTAINER!.trim();

  return {
    kind: "azure",
    accountName: credentials.accountName,
    container,
  };
}

export async function resolveProjectStorageDestination(
  projectId: string,
): Promise<ProjectStorageDestination> {
  const privateConfig = await getS3ConfigForProject(projectId);
  if (privateConfig?.bucket) {
    return { kind: "s3", bucket: privateConfig.bucket };
  }

  if (env.STORED_OBJECTS_BACKEND === "azure") {
    return resolveAzureDestination();
  }

  const globalBucket = env.S3_BUCKET_NAME?.trim();
  if (globalBucket) {
    return { kind: "s3", bucket: globalBucket };
  }

  const root = env.LANGWATCH_LOCAL_STORAGE_PATH ?? DEFAULT_LOCAL_FS_ROOT;
  return { kind: "file", root };
}

/**
 * Returns a log-safe version of a storage URI: bucket / account / path
 * segments that could identify a tenant's storage account are replaced
 * with `***`. Use this in any structured log that ships to a shared
 * sink — a BYOC tenant's bucket name is a cross-tenant disclosure
 * channel otherwise (security-reviewer, PR-4058 review).
 *
 * Format examples (REDACTED stands in for the three-asterisk placeholder we
 * emit, written out here to avoid the asterisk-slash sequence prematurely
 * terminating this JSDoc block):
 *   s3://customer-private/proj-abc/sha256  -> s3://REDACTED/proj-abc/sha256
 *   file:///var/lib/langwatch/objects/...  -> file:///REDACTED/...
 *   azure-blob://acct/cont/proj/sha        -> azure-blob://REDACTED/REDACTED/proj/sha
 */
export function redactStorageUri(uri: string): string {
  try {
    const colonSlashSlash = uri.indexOf("://");
    if (colonSlashSlash === -1) return uri;
    const scheme = uri.slice(0, colonSlashSlash);
    // Schemes are case-insensitive in URI syntax; an SDK that quotes
    // `S3://bucket/key` must still be redacted (text-level redactor uses /i).
    const schemeLower = scheme.toLowerCase();
    const rest = uri.slice(colonSlashSlash + 3);

    if (schemeLower === "s3" || schemeLower === "gs") {
      // s3://bucket/projectId/sha256 and gs://bucket/projectId/sha256 — bucket
      // identifies the tenant's storage account; the rest is content-addressed.
      const slash = rest.indexOf("/");
      if (slash === -1) return `${scheme}://***`;
      return `${scheme}://***${rest.slice(slash)}`;
    }
    if (schemeLower === "azure-blob") {
      // azure-blob://account/container/projectId/sha256 — first 2 path
      // segments identify the tenant's storage account; rest is content-
      // addressed and safe.
      const segments = rest.split("/");
      const safe = segments.slice(2).join("/");
      return `${scheme}://***/***${safe ? "/" + safe : ""}`;
    }
    if (schemeLower === "file") {
      // file:///<root>/<projectId>/<sha256> — root may encode the install
      // path of a self-host tenant; treat as sensitive.
      const slash = rest.indexOf("/", 1);
      if (slash === -1) return `${scheme}:///***`;
      const tail = rest.slice(slash);
      const lastTwoSlashes = tail.lastIndexOf("/", tail.lastIndexOf("/") - 1);
      return `${scheme}:///***${lastTwoSlashes !== -1 ? tail.slice(lastTwoSlashes) : ""}`;
    }
    return uri;
  } catch {
    return "<unredactable-uri>";
  }
}

const STORAGE_URI_IN_TEXT = /\b(?:s3|azure-blob|gs|file):\/\/[^\s'"]+/gi;

/**
 * Redacts every storage URI embedded in a free-text string — e.g. an object-
 * store SDK error message that quotes the failing `s3://bucket/key`. Use on any
 * error text that ships to a shared log sink: a BYOC tenant's bucket / account
 * is a cross-tenant disclosure channel otherwise.
 */
export function redactStorageUrisInText(text: string): string {
  return text.replace(STORAGE_URI_IN_TEXT, (uri) => redactStorageUri(uri));
}

/**
 * Authorization material that must never reach a log sink, an error message,
 * or a trace attribute:
 *
 *   Bearer <jwt>            — a live credential for the token's whole lifetime.
 *   SharedKey account:sig   — the HMAC signature, plus the account name.
 *   <assertion>...          — the federated token exchanged for the above.
 *
 * This matters because object-store errors are quoted verbatim: Azure answers
 * a failed shared-key request with an AuthenticationFailed body that echoes
 * the signed string back, and a bearer 401 can carry the presented token in
 * the WWW-Authenticate error detail. Anything derived from a response body or
 * a thrown SDK error goes through here before it is surfaced.
 */
// A credential after an auth scheme. The {20,} floor keeps ordinary prose
// intact — "SharedKey authentication is disabled" must not become
// "SharedKey ***" — while every real token comfortably exceeds it.
const AUTHORIZATION_MATERIAL_IN_TEXT =
  /\b(Bearer|SharedKey|SharedKeyLite)\s+[A-Za-z0-9\-._~+/=:]{20,}/gi;

// The identity endpoint speaks JSON and form-encoding, not XML: an error
// quoting a token response or a request body carries the credential as a
// key/value pair, which the scheme pattern above never sees.
const CREDENTIAL_FIELD_IN_TEXT =
  /\b(access_token|id_token|refresh_token|client_assertion|assertion|client_secret)\b("?)(\s*[=:]\s*)("?)[A-Za-z0-9\-._~+/=]{20,}("?)/gi;

// Azure echoes signed-request detail back in XML error bodies. The tag may
// carry attributes (xml:space="preserve"), so the name match must not
// assume the tag closes immediately after it.
const XML_ASSERTION_IN_TEXT =
  /<(AuthenticationErrorDetail|assertion|client_assertion)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function redactAuthorizationMaterial(text: string): string {
  return (
    text
      .replace(
        AUTHORIZATION_MATERIAL_IN_TEXT,
        (_m, scheme: string) => `${scheme} ***`,
      )
      // Each quote is captured and re-emitted rather than assumed: consuming the
      // key's closing quote without restoring it turned
      // `"access_token":"…"` into `"access_token:"***"`, which redacts the
      // token but leaves JSON a downstream log parser can no longer read.
      // Captures arrive as a rest array: `String.replace` fixes this callback's
      // arity at one-per-group (plus offset and subject), so naming each group
      // as its own parameter trips the max-parameter rule on a signature the
      // regex dictates rather than the design.
      .replace(CREDENTIAL_FIELD_IN_TEXT, (_m, ...captures: string[]) => {
        const [field, keyQuote, separator, openQuote, closeQuote] = captures;
        return `${field}${keyQuote}${separator}${openQuote}***${closeQuote}`;
      })
      .replace(
        XML_ASSERTION_IN_TEXT,
        (_m, tag: string) => `<${tag}>***</${tag}>`,
      )
  );
}

/**
 * The redaction every storage error text should pass through: tenant-identifying
 * URIs AND authorization material. Callers should not have to remember both.
 */
export function redactStorageErrorText(text: string): string {
  return redactAuthorizationMaterial(redactStorageUrisInText(text));
}
