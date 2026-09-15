/**
 * Where a transient spool object lives, and what a spool reference may claim. Pure: the path is
 * derived from server-trusted ids alone, so a read and a delete land on exactly what the write
 * created, and a reference that still carries a location is pinned to its own tenant.
 */
import { createHash } from "node:crypto";

/**
 * Prefix for all transient spool objects, kept above the tenant segment so a lifecycle rule can
 * match it with a plain prefix filter. S3 lifecycle filters cannot wildcard a leading tenant
 * segment, so a tenant-first path would be unexpirable. Do not reorder.
 */
export const SPOOL_KEY_PREFIX = "trace-blobs/spool";

/**
 * Marker carried by a spooled command instead of a storage path. v1 put the raw object key in the
 * command and parsed the tenant back out of it, so an influenced queue message could steer a read
 * at another tenant's object; v2 re-derives the location from the command's own trusted ids.
 */
export const SPOOL_REF_V2 = "spool:v2";

/**
 * Ids that are safe to use verbatim as one path segment: the normal case, since
 * OTLP ids normalise to hex. Excludes `.` and `..` explicitly — both match the
 * character class but are directory references, not names.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Reduces one id to a single path component. Percent-encoding alone is not enough, since the local
 * driver decodes before writing and an id of dot-dot segments could escape the object root, so
 * anything outside the safe class is replaced by a deterministic hash rather than escaped.
 */
export function safePathSegment(id: string): string {
  if (SAFE_PATH_SEGMENT.test(id) && id !== "." && id !== "..") {
    return id;
  }

  return createHash("sha256").update(id, "utf8").digest("hex");
}

/**
 * Builds the transient spool object path. The ONLY place the shape is encoded.
 */
export function buildSpoolObjectPath({
  projectId,
  traceId,
  spanId,
}: {
  projectId: string;
  traceId: string;
  spanId: string;
}): string {
  return [
    SPOOL_KEY_PREFIX,
    safePathSegment(projectId),
    safePathSegment(traceId),
    safePathSegment(spanId),
  ].join("/");
}

/**
 * True when spoolRef has the v1 shape, a raw key minted before this deployment; in-flight commands
 * still carry these, so both formats resolve for one release. Matched by prefix rather than by not
 * being v2, since treating every unrecognised string as v1 would reopen what v2 closes.
 */
export function isLegacySpoolRef(spoolRef: string): boolean {
  return spoolRef.startsWith(`${SPOOL_KEY_PREFIX}/`);
}

/**
 * Extracts the projectId segment from a v1 spool key. The caller must check it against the
 * command's authenticated tenant before dereferencing — see {@link assertLegacySpoolKeyBelongsTo}.
 */
export function projectIdFromLegacySpoolKey(spoolRef: string): string {
  return spoolRef.split("/")[SPOOL_KEY_PREFIX.split("/").length] ?? "";
}

/**
 * Refuses a v1 key whose tenant segment is not the tenant the command was authenticated as. v1 is
 * the one place a location still travels inside the command, so it is the one place a tampered
 * reference could steer a read; pinning it keeps the compatibility window from reopening the hole.
 */
export function assertLegacySpoolKeyBelongsTo(spoolRef: string, projectId: string): void {
  const keyProjectId = projectIdFromLegacySpoolKey(spoolRef);
  if (keyProjectId !== projectId) {
    throw new Error(
      `Refusing to read spool object: reference names tenant "${keyProjectId}" but the command is authenticated as "${projectId}".`,
    );
  }
}
