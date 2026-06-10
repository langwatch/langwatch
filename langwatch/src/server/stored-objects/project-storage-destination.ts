/**
 * One place that decides where a project's externalized bytes live.
 *
 * `resolveProjectStorageDestination(projectId)` is the single source of
 * truth for the precedence used by every byte-writing path:
 *
 *   1. BYOC: the per-project private dataplane bucket from
 *      `getS3ConfigForProject`. Tenant-owned; never silently bypassed.
 *   2. Global S3: `env.S3_BUCKET_NAME`, when set and non-empty.
 *   3. Local filesystem: `env.LANGWATCH_LOCAL_STORAGE_PATH` (or a
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

export type ProjectStorageDestination =
  | { kind: "s3"; bucket: string }
  | { kind: "file"; root: string };

/**
 * Default local filesystem root used when neither a BYOC bucket nor
 * `S3_BUCKET_NAME` is configured. Matches the chart's
 * `app.storedObjects.localFilesystem.path` default and the
 * `.env.example` comment.
 */
const DEFAULT_LOCAL_FS_ROOT = "/var/lib/langwatch/objects";

export async function resolveProjectStorageDestination(
  projectId: string,
): Promise<ProjectStorageDestination> {
  const privateConfig = await getS3ConfigForProject(projectId);
  if (privateConfig?.bucket) {
    return { kind: "s3", bucket: privateConfig.bucket };
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
    const rest = uri.slice(colonSlashSlash + 3);

    if (scheme === "s3") {
      const slash = rest.indexOf("/");
      if (slash === -1) return `${scheme}://***`;
      return `${scheme}://***${rest.slice(slash)}`;
    }
    if (scheme === "azure-blob") {
      // azure-blob://account/container/projectId/sha256 — first 2 path
      // segments identify the tenant's storage account; rest is content-
      // addressed and safe.
      const segments = rest.split("/");
      const safe = segments.slice(2).join("/");
      return `${scheme}://***/***${safe ? "/" + safe : ""}`;
    }
    if (scheme === "file") {
      // file:///<root>/<projectId>/<sha256> — root may encode the install
      // path of a self-host tenant; treat as sensitive.
      const slash = rest.indexOf("/", 1);
      if (slash === -1) return `${scheme}:///***`;
      const tail = rest.slice(slash);
      const lastTwoSlashes = tail.lastIndexOf(
        "/",
        tail.lastIndexOf("/") - 1,
      );
      return `${scheme}:///***${lastTwoSlashes !== -1 ? tail.slice(lastTwoSlashes) : ""}`;
    }
    return uri;
  } catch {
    return "<unredactable-uri>";
  }
}
