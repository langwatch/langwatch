/** The upload wire: create, PUT to the signed URL, confirm (ADR-158 §4). */
import { z } from "zod";

import { storedObjectIdSchema, storedObjectProjectIdSchema } from "./ids.ts";
import {
  storedObjectByteLengthSchema,
  storedObjectFilenameSchema,
  storedObjectMediaTypeSchema,
  storedObjectTimestampSchema,
} from "./metadata.ts";
import { storedObjectReferenceSchema } from "./references.ts";

export const storedObjectsCreateUploadInputSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    purpose: z.string().min(1).max(127),
    filename: storedObjectFilenameSchema,
    mediaType: storedObjectMediaTypeSchema,
    byteLength: storedObjectByteLengthSchema,
  })
  .strict();
export type StoredObjectsCreateUploadInput = z.infer<typeof storedObjectsCreateUploadInputSchema>;

export const storedObjectsCreateUploadOutputSchema = z
  .object({
    objectId: storedObjectIdSchema,
    uploadUrl: z.string().url(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string().min(1)).optional(),
    expiresAt: storedObjectTimestampSchema,
  })
  .strict();
export type StoredObjectsCreateUploadOutput = z.infer<typeof storedObjectsCreateUploadOutputSchema>;

export const storedObjectsConfirmUploadInputSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    objectId: storedObjectIdSchema,
  })
  .strict();
export type StoredObjectsConfirmUploadInput = z.infer<typeof storedObjectsConfirmUploadInputSchema>;

export const storedObjectsConfirmUploadOutputSchema = storedObjectReferenceSchema;
export type StoredObjectsConfirmUploadOutput = z.infer<
  typeof storedObjectsConfirmUploadOutputSchema
>;

/** The stored-object REST routes' path parameter. */
export const storedObjectParamsSchema = z.object({ storedObjectId: storedObjectIdSchema });

/** The hidden local route's query: the seal `createUpload` put in the URL. */
export const storedObjectUploadSignatureSchema = z.string().min(1).max(8192).regex(/^\S+$/u);
