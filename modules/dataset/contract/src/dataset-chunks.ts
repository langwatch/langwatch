import { z } from "zod";
/** Tenant-prefixed, ordered chunk key for the object-backed dataset layout. */
export const chunkKey = (projectId: string, datasetId: string, index: number): string =>
  `datasets/${projectId}/${datasetId}/chunk-${String(index).padStart(5, "0")}.jsonl`;

/**
 * Guard against `..` / `/` in an id segment before it is interpolated into
 * an object key or filesystem path. Shared by every storage implementation so
 * the traversal invariant (I-TENANT) is enforced in exactly one place.
 */
export const assertNoTraversal = (...parts: string[]): void => {
  for (const part of parts) {
    if (part.includes("..") || part.includes("/")) {
      throw new Error("Invalid id: path traversal attempt detected");
    }
  }
};

/**
 * Guard a full storage key (which legitimately contains `/`) before it is path-joined to disk
 * or sent to S3.
 */
export const assertKeyWithinProject = (projectId: string, key: string): void => {
  assertNoTraversal(projectId);
  if (key.includes("..")) {
    throw new Error("Invalid key: path traversal attempt detected");
  }

  if (key.startsWith("/")) {
    throw new Error("Invalid key: path traversal attempt detected");
  }

  if (!key.startsWith(`staging/${projectId}/`)) {
    throw new Error("Invalid key: path traversal attempt detected");
  }
};

const normalizeTarget = {
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  filename: z.string().min(1),
};

/**
 * Durable payload for Dataset's normalization worker lane. The `stagingKey`
 * form was queued by the previous release and is read for one more (ADR-155).
 */
export const datasetNormalizePayloadSchema = z.union([
  z.object({ ...normalizeTarget, sourceStoredObjectId: z.string().min(1) }),
  z.object({ ...normalizeTarget, stagingKey: z.string().min(1) }),
]);

export type DatasetNormalizePayload = z.infer<typeof datasetNormalizePayloadSchema>;
