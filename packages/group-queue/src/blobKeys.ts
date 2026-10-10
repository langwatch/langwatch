import type { TenantId } from "./storage.ts";

/**
 * Centralized tenant-namespaced blob key layout; projectId is branded
 * {@link TenantId} to enforce tenant boundaries at the minting API.
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

/** Kind-first prefix an operator lifecycle rule targets (ADR-172). */
export const S3_TIER_KEY_PREFIX = "group-queue";

/** `group-queue/<projectId>/<hash>` — the durable object path of an S3-tier blob. */
export function blobObjectPath({ projectId, hash }: { projectId: TenantId; hash: string }): string {
  return `${S3_TIER_KEY_PREFIX}/${blobNamespaceId({ projectId, hash })}`;
}

/** `<projectId>/<hash>` — the pre-ADR-172 object path, read only for in-flight jobs. */
export function legacyBlobObjectPath({
  projectId,
  hash,
}: {
  projectId: TenantId;
  hash: string;
}): string {
  return blobNamespaceId({ projectId, hash });
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
