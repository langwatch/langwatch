import { z } from "zod";
import { storedObjectDeliveryAudienceSchema } from "./audiences";
import {
  storedObjectGenerationSchema,
  storedObjectIdSchema,
  storedObjectOperationIdSchema,
  storedObjectProjectIdSchema,
} from "./ids";
import { hasControlCharacters } from "./validation";

export const STORED_OBJECT_FILENAME_MAX_BYTES = 255;
export const STORED_OBJECT_MEDIA_TYPE_MAX_CHARACTERS = 127;

const PRINTABLE_ASCII_PATTERN = /^[\u0020-\u007e]+$/u;

/** Portable UTF-8 byte count with no runtime-specific byte or DOM dependency. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export const storedObjectFilenameSchema = z
  .string()
  .min(1, "filename is required")
  .refine((value) => !hasControlCharacters(value), {
    message: "filename must not contain control characters",
  })
  .transform((value) => value.normalize("NFC"))
  .refine((value) => utf8ByteLength(value) <= STORED_OBJECT_FILENAME_MAX_BYTES, {
    message: `filename must be at most ${STORED_OBJECT_FILENAME_MAX_BYTES} UTF-8 bytes after normalization`,
  });
export type StoredObjectFilename = z.infer<typeof storedObjectFilenameSchema>;

export const storedObjectMediaTypeSchema = z
  .string()
  .min(1, "mediaType is required")
  .max(
    STORED_OBJECT_MEDIA_TYPE_MAX_CHARACTERS,
    `mediaType must be at most ${STORED_OBJECT_MEDIA_TYPE_MAX_CHARACTERS} characters`,
  )
  .regex(PRINTABLE_ASCII_PATTERN, {
    message: "mediaType must contain only printable ASCII characters",
  });
export type StoredObjectMediaType = z.infer<typeof storedObjectMediaTypeSchema>;

export const storedObjectSha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "sha256 must be 64 lowercase hexadecimal characters");
export type StoredObjectSha256 = z.infer<typeof storedObjectSha256Schema>;

export const storedObjectByteLengthSchema = z.number().int().nonnegative().safe();
export type StoredObjectByteLength = z.infer<typeof storedObjectByteLengthSchema>;

/** Applies the runtime's semantic maximum without creating a second wire type. */
export function createStoredObjectByteLengthSchema(maximumBytes: number) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("maximumBytes must be a non-negative safe integer");
  }
  return storedObjectByteLengthSchema.max(
    maximumBytes,
    `byteLength must not exceed ${maximumBytes}`,
  );
}

export const storedObjectTimestampSchema = z.string().datetime({ offset: true });
export type StoredObjectTimestamp = z.infer<typeof storedObjectTimestampSchema>;

export const storedObjectProvenanceSchema = z
  .object({
    purpose: z.string().min(1).max(127),
    ownerKind: z.string().min(1).max(127),
    ownerId: z.string().min(1).max(255),
  })
  .strict();
export type StoredObjectProvenance = z.infer<typeof storedObjectProvenanceSchema>;

export const storedObjectLifecycleStatusSchema = z.enum([
  "pending",
  "available",
  "deleted",
  "failed",
]);
export type StoredObjectLifecycleStatus = z.infer<typeof storedObjectLifecycleStatusSchema>;

export const storedObjectWriteOperationStatusSchema = z.enum([
  "pending",
  "confirming",
  "available",
  "expired",
  "failed",
  "reconciling",
  "cancelled",
]);
export type StoredObjectWriteOperationStatus = z.infer<
  typeof storedObjectWriteOperationStatusSchema
>;

export const storedObjectMetadataSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
    sha256: storedObjectSha256Schema,
    byteLength: storedObjectByteLengthSchema,
    mediaType: storedObjectMediaTypeSchema,
    mediaTypeVerified: z.boolean(),
    status: storedObjectLifecycleStatusSchema,
    audiences: z.array(storedObjectDeliveryAudienceSchema),
    generation: storedObjectGenerationSchema,
    provenance: storedObjectProvenanceSchema,
    createdAt: storedObjectTimestampSchema,
    availableAt: storedObjectTimestampSchema.optional(),
    deletedAt: storedObjectTimestampSchema.optional(),
  })
  .strict();
export type StoredObjectMetadata = z.infer<typeof storedObjectMetadataSchema>;

export const storedObjectWriteOperationSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    operationId: storedObjectOperationIdSchema,
    objectId: storedObjectIdSchema,
    status: storedObjectWriteOperationStatusSchema,
    expiresAt: storedObjectTimestampSchema,
    createdAt: storedObjectTimestampSchema,
    completedAt: storedObjectTimestampSchema.optional(),
  })
  .strict();
export type StoredObjectWriteOperation = z.infer<typeof storedObjectWriteOperationSchema>;

export const storedObjectStorageUsageSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    activeObjectCount: z.number().int().nonnegative().safe(),
    activeByteLength: storedObjectByteLengthSchema,
    purpose: z.string().min(1).max(127).optional(),
  })
  .strict();
export type StoredObjectStorageUsage = z.infer<typeof storedObjectStorageUsageSchema>;
