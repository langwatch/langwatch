import type { Named } from "@langwatch/module";
import { z } from "zod";

import { storedObjectDeliveryAudienceSchema } from "./audiences.ts";
import {
  storedObjectGenerationSchema,
  storedObjectIdSchema,
  storedObjectProjectIdSchema,
} from "./ids.ts";
import {
  storedObjectByteLengthSchema,
  storedObjectFilenameSchema,
  storedObjectMediaTypeSchema,
  storedObjectSha256Schema,
  storedObjectTimestampSchema,
} from "./metadata.ts";

/**
 * A durable feature-owned reference. It intentionally carries presentation
 * facts and an audience, but never a provider or service delivery URL.
 */
const storedObjectReferenceSchemaDefinition = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
    sha256: storedObjectSha256Schema,
    byteLength: storedObjectByteLengthSchema,
    filename: storedObjectFilenameSchema,
    mediaType: storedObjectMediaTypeSchema,
    audience: storedObjectDeliveryAudienceSchema,
  })
  .strict();
export interface StoredObjectReferenceSchema extends Named<
  typeof storedObjectReferenceSchemaDefinition
> {}
export const storedObjectReferenceSchema: StoredObjectReferenceSchema =
  storedObjectReferenceSchemaDefinition;
export type StoredObjectReference = z.infer<typeof storedObjectReferenceSchema>;

export const storedObjectDeliveryMethodSchema = z.enum(["GET", "HEAD"]);
export type StoredObjectDeliveryMethod = z.infer<typeof storedObjectDeliveryMethodSchema>;

const storedObjectDeliveryCapabilitySchemaDefinition = z
  .object({
    url: z.string().url(),
    expiresAt: storedObjectTimestampSchema,
    methods: z.array(storedObjectDeliveryMethodSchema).nonempty(),
    audience: storedObjectDeliveryAudienceSchema,
    generation: storedObjectGenerationSchema,
  })
  .strict();
export interface StoredObjectDeliveryCapabilitySchema extends Named<
  typeof storedObjectDeliveryCapabilitySchemaDefinition
> {}
export const storedObjectDeliveryCapabilitySchema: StoredObjectDeliveryCapabilitySchema =
  storedObjectDeliveryCapabilitySchemaDefinition;
export type StoredObjectDeliveryCapability = z.infer<typeof storedObjectDeliveryCapabilitySchema>;

const resolvedStoredObjectSchemaDefinition = z
  .object({
    reference: storedObjectReferenceSchema,
    capability: storedObjectDeliveryCapabilitySchema,
  })
  .strict();
export interface ResolvedStoredObjectSchema extends Named<
  typeof resolvedStoredObjectSchemaDefinition
> {}
export const resolvedStoredObjectSchema: ResolvedStoredObjectSchema =
  resolvedStoredObjectSchemaDefinition;
export type ResolvedStoredObject = z.infer<typeof resolvedStoredObjectSchema>;
