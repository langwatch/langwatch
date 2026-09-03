import { z } from "zod";
import {
  storedObjectIdSchema,
  storedObjectOperationIdSchema,
  storedObjectProjectIdSchema,
} from "./ids";
import {
  createStoredObjectByteLengthSchema,
  storedObjectByteLengthSchema,
  storedObjectFilenameSchema,
  storedObjectMediaTypeSchema,
  storedObjectSha256Schema,
  storedObjectTimestampSchema,
} from "./metadata";
import { storedObjectReferenceSchema } from "./references";

export const storedObjectUploadTokenSchema = z
  .string()
  .min(1, "uploadToken is required")
  .max(8192, "uploadToken is too long")
  .regex(/^\S+$/u, "uploadToken must not contain whitespace");
export type StoredObjectUploadToken = z.infer<typeof storedObjectUploadTokenSchema>;

export const storedObjectUploadMetadataSchema = z
  .object({
    filename: storedObjectFilenameSchema,
    mediaType: storedObjectMediaTypeSchema,
    byteLength: storedObjectByteLengthSchema,
    sha256: storedObjectSha256Schema,
  })
  .strict();
export type StoredObjectUploadMetadata = z.infer<typeof storedObjectUploadMetadataSchema>;

/** Builds the same upload shape with the runtime's configured byte ceiling. */
export function createStoredObjectUploadMetadataSchema(maximumUploadBytes: number) {
  return storedObjectUploadMetadataSchema.extend({
    byteLength: createStoredObjectByteLengthSchema(maximumUploadBytes),
  });
}

export const storedObjectDirectUploadTargetSchema = z
  .object({
    method: z.literal("PUT"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string().min(1)),
    expiresAt: storedObjectTimestampSchema,
  })
  .strict();
export type StoredObjectDirectUploadTarget = z.infer<typeof storedObjectDirectUploadTargetSchema>;

export const storedObjectsCreateUploadInputSchema = storedObjectUploadMetadataSchema.extend({
  projectId: storedObjectProjectIdSchema,
});
export type StoredObjectsCreateUploadInput = z.infer<typeof storedObjectsCreateUploadInputSchema>;

export function createStoredObjectsCreateUploadInputSchema(maximumUploadBytes: number) {
  return createStoredObjectUploadMetadataSchema(maximumUploadBytes).extend({
    projectId: storedObjectProjectIdSchema,
  });
}

export const storedObjectsCreateUploadOutputSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("existing"),
      reference: storedObjectReferenceSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("pending"),
      objectId: storedObjectIdSchema,
      operationId: storedObjectOperationIdSchema,
      uploadToken: storedObjectUploadTokenSchema,
      upload: storedObjectDirectUploadTargetSchema,
    })
    .strict(),
]);
export type StoredObjectsCreateUploadOutput = z.infer<typeof storedObjectsCreateUploadOutputSchema>;

export const storedObjectsConfirmUploadInputSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    uploadToken: storedObjectUploadTokenSchema,
  })
  .strict();
export type StoredObjectsConfirmUploadInput = z.infer<typeof storedObjectsConfirmUploadInputSchema>;

export const storedObjectsConfirmUploadOutputSchema = storedObjectReferenceSchema;
export type StoredObjectsConfirmUploadOutput = z.infer<
  typeof storedObjectsConfirmUploadOutputSchema
>;
