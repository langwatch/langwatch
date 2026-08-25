import { z } from "zod";
import { hasControlCharacters } from "./validation";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function opaqueIdSchema(label: string) {
  return z
    .string()
    .min(1, `${label} is required`)
    .max(255, `${label} must be at most 255 characters`)
    .regex(OPAQUE_ID_PATTERN, `${label} is not a valid opaque identifier`);
}

/** Authenticated project scope. It is never accepted as public RPC authority. */
export const storedObjectProjectIdSchema = opaqueIdSchema("projectId");
export type StoredObjectProjectId = z.infer<typeof storedObjectProjectIdSchema>;

/** Stable content ID derived from authenticated project + SHA-256. */
export const storedObjectIdSchema = opaqueIdSchema("storedObjectId");
export type StoredObjectId = z.infer<typeof storedObjectIdSchema>;

/** One write attempt. Several write operations may target one content ID. */
export const storedObjectOperationIdSchema = opaqueIdSchema("operationId");
export type StoredObjectOperationId = z.infer<typeof storedObjectOperationIdSchema>;

/** One logical-delete command, distinct from the content generation it removes. */
export const storedObjectDeletionIdSchema = opaqueIdSchema("deletionId");
export type StoredObjectDeletionId = z.infer<typeof storedObjectDeletionIdSchema>;

/** Identifies one short-lived service delivery capability without exposing its secret. */
export const storedObjectCapabilityIdSchema = opaqueIdSchema("capabilityId");
export type StoredObjectCapabilityId = z.infer<typeof storedObjectCapabilityIdSchema>;

/** Monotonic lifecycle generation used to fence stale delivery and deletion work. */
export const storedObjectGenerationSchema = z.number().int().nonnegative().safe();
export type StoredObjectGeneration = z.infer<typeof storedObjectGenerationSchema>;

/** A caller-stable key scoped to authenticated project and operation kind. */
export const storedObjectIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !hasControlCharacters(value), {
    message: "idempotencyKey must not contain control characters",
  });
export type StoredObjectIdempotencyKey = z.infer<typeof storedObjectIdempotencyKeySchema>;

export const storedObjectIdentitySchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
  })
  .strict();
export type StoredObjectIdentity = z.infer<typeof storedObjectIdentitySchema>;

/**
 * Runtime capability that preserves the existing authenticated-project +
 * SHA-256 derivation without pulling crypto or KSUID implementations into the
 * portable contract.
 */
export interface StoredObjectIdDeriver {
  fromDigest(input: {
    projectId: StoredObjectProjectId;
    sha256: string;
  }): Promise<StoredObjectId> | StoredObjectId;
}
