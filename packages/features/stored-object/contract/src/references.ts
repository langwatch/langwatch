import { z } from "zod";
import { storedObjectDeliveryAudienceSchema } from "./audiences";
import {
  storedObjectGenerationSchema,
  storedObjectIdSchema,
  storedObjectProjectIdSchema,
} from "./ids";
import {
  storedObjectByteLengthSchema,
  storedObjectFilenameSchema,
  storedObjectMediaTypeSchema,
  storedObjectSha256Schema,
  storedObjectTimestampSchema,
} from "./metadata";

/**
 * A durable feature-owned reference. It intentionally carries presentation
 * facts and an audience, but never a provider or service delivery URL.
 */
export const storedObjectReferenceSchema = z
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
export type StoredObjectReference = z.infer<typeof storedObjectReferenceSchema>;

export const storedObjectDeliveryMethodSchema = z.enum(["GET", "HEAD"]);
export type StoredObjectDeliveryMethod = z.infer<
  typeof storedObjectDeliveryMethodSchema
>;

export const storedObjectDeliveryCapabilitySchema = z
  .object({
    url: z.string().url(),
    expiresAt: storedObjectTimestampSchema,
    methods: z.array(storedObjectDeliveryMethodSchema).nonempty(),
    audience: storedObjectDeliveryAudienceSchema,
    generation: storedObjectGenerationSchema,
  })
  .strict();
export type StoredObjectDeliveryCapability = z.infer<
  typeof storedObjectDeliveryCapabilitySchema
>;

export const resolvedStoredObjectSchema = z
  .object({
    reference: storedObjectReferenceSchema,
    capability: storedObjectDeliveryCapabilitySchema,
  })
  .strict();
export type ResolvedStoredObject = z.infer<typeof resolvedStoredObjectSchema>;
