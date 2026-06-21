import type { TenantId } from "~/server/event-sourcing/domain/tenantId";

/**
 * The single source of truth for the redis key layout of offloaded blobs and
 * their holder sets. Two collaborators must agree on it byte-for-byte — the
 * blob store writes the blob key, and the holder-set Lua `UNLINK`s it on
 * reclaim — so the layout lives here rather than being reconstructed in each.
 * Changing a prefix in one place without the other would silently break
 * reclamation, with no compiler signal; centralizing removes that drift.
 *
 * Keys carry the queue name (with its cluster hash tag) so a blob, its holder
 * set, and the queue's other keys all land in one cluster slot.
 *
 * `projectId` is the branded {@link TenantId} so the tenant boundary stays
 * intact at the exact API that mints tenant-scoped keys (ADR-030 §5) — a
 * caller can't accidentally pass a raw user-controlled string.
 */

/** `<projectId>/<hash>` — the tenant-namespaced content id a blob is keyed by. */
export function blobNamespaceId({
  projectId,
  hash,
}: {
  projectId: TenantId;
  hash: string;
}): string {
  return `${projectId}/${hash}`;
}

/** Redis key prefix for offloaded blob bytes (the store keys by prefix + id). */
export function redisBlobKeyPrefix(queueName: string): string {
  return `${queueName}:gq:blob:`;
}

/** Full redis key for an offloaded blob's bytes. */
export function redisBlobKey(params: {
  queueName: string;
  projectId: TenantId;
  hash: string;
}): string {
  return `${redisBlobKeyPrefix(params.queueName)}${blobNamespaceId(params)}`;
}

/** Full redis key for a blob's holder set (the per-blob reference count). */
export function blobHolderSetKey(params: {
  queueName: string;
  projectId: TenantId;
  hash: string;
}): string {
  return `${params.queueName}:gq:blobholders:${blobNamespaceId(params)}`;
}
