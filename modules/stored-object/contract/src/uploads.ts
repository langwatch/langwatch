import type { Named } from "@langwatch/module";
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

const storedObjectsCreateUploadInputSchemaDefinition = z
  .object({
    projectId: storedObjectProjectIdSchema,
    purpose: z.string().min(1).max(127),
    filename: storedObjectFilenameSchema,
    mediaType: storedObjectMediaTypeSchema,
    byteLength: storedObjectByteLengthSchema,
  })
  .strict();
export interface StoredObjectsCreateUploadInputSchema extends Named<
  typeof storedObjectsCreateUploadInputSchemaDefinition
> {}
export const storedObjectsCreateUploadInputSchema: StoredObjectsCreateUploadInputSchema =
  storedObjectsCreateUploadInputSchemaDefinition;
export type StoredObjectsCreateUploadInput = z.infer<typeof storedObjectsCreateUploadInputSchema>;

const storedObjectsCreateUploadOutputSchemaDefinition = z
  .object({
    objectId: storedObjectIdSchema,
    uploadUrl: z.string().url(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string().min(1)).optional(),
    expiresAt: storedObjectTimestampSchema,
  })
  .strict();
export interface StoredObjectsCreateUploadOutputSchema extends Named<
  typeof storedObjectsCreateUploadOutputSchemaDefinition
> {}
export const storedObjectsCreateUploadOutputSchema: StoredObjectsCreateUploadOutputSchema =
  storedObjectsCreateUploadOutputSchemaDefinition;
export type StoredObjectsCreateUploadOutput = z.infer<typeof storedObjectsCreateUploadOutputSchema>;

const storedObjectsConfirmUploadInputSchemaDefinition = z
  .object({
    projectId: storedObjectProjectIdSchema,
    objectId: storedObjectIdSchema,
  })
  .strict();
export interface StoredObjectsConfirmUploadInputSchema extends Named<
  typeof storedObjectsConfirmUploadInputSchemaDefinition
> {}
export const storedObjectsConfirmUploadInputSchema: StoredObjectsConfirmUploadInputSchema =
  storedObjectsConfirmUploadInputSchemaDefinition;
export type StoredObjectsConfirmUploadInput = z.infer<typeof storedObjectsConfirmUploadInputSchema>;

export const storedObjectsConfirmUploadOutputSchema = storedObjectReferenceSchema;
export type StoredObjectsConfirmUploadOutput = z.infer<
  typeof storedObjectsConfirmUploadOutputSchema
>;

/** The stored-object REST routes' path parameter. */
const storedObjectParamsSchemaDefinition = z.object({ storedObjectId: storedObjectIdSchema });
export interface StoredObjectParamsSchema extends Named<
  typeof storedObjectParamsSchemaDefinition
> {}
export const storedObjectParamsSchema: StoredObjectParamsSchema =
  storedObjectParamsSchemaDefinition;

/** The hidden local route's query: the seal `createUpload` put in the URL. */
export const storedObjectUploadSignatureSchema = z.string().min(1).max(8192).regex(/^\S+$/u);

/**
 * LangWatch's signed upload route, and how long a body sent to it may take: 5 GiB at about
 * 6 Mbit/s. The segment admits no dot segment or escape, so no other route borrows it (#9666).
 */
export const STORED_OBJECT_UPLOAD_REQUEST_BODY = {
  path: /^\/api\/stored-objects\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*\/content$/,
  timeoutMs: 2 * 60 * 60_000,
} as const;
