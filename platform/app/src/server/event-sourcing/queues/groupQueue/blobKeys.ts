import type { TenantId } from "~/server/event-sourcing/domain/tenantId";

/**
 * The single source of truth for the redis key layout of offloaded blobs and
 * their lease sets. Centralizing the tenant-namespaced key layout keeps the
 * blob store, lease scripts, and rolling-deploy compatibility guard aligned.
 *
 * Keys carry the queue name (with its cluster hash tag) so a blob, its lease
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

/** Full Redis key for a blob's per-holder lease deadlines. */
export function blobLeaseSetKey(params: {
  queueName: string;
  projectId: TenantId;
  hash: string;
}): string {
  return `${params.queueName}:gq:blobleases:${blobNamespaceId(params)}`;
}

/**
 * Legacy ref-count holder key retained only as a rolling-deploy guard. New
 * lifecycle decisions never derive liveness from this set.
 */
export function blobHolderSetKey(params: {
  queueName: string;
  projectId: TenantId;
  hash: string;
}): string {
  return `${params.queueName}:gq:blobholders:${blobNamespaceId(params)}`;
}
