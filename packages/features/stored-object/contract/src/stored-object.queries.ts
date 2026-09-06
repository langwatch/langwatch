import type { AuthzPermission } from "@langwatch/authz-contract";
import { z, type ZodTypeAny } from "zod";
import { storedObjectDeliveryAudienceSchema } from "./audiences.ts";
import { storedObjectIdSchema, storedObjectProjectIdSchema } from "./ids.ts";
import { storedObjectLifecycleStatusSchema, storedObjectMetadataSchema } from "./metadata.ts";
import { storedObjectDeliveryCapabilitySchema } from "./references.ts";

const internalIdentitySchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
  })
  .strict();

export const storedObjectsMetadataInputSchema = internalIdentitySchema;
export type StoredObjectsMetadataInput = z.infer<typeof storedObjectsMetadataInputSchema>;
export const storedObjectsMetadataOutputSchema = storedObjectMetadataSchema;
export type StoredObjectsMetadataOutput = z.infer<typeof storedObjectsMetadataOutputSchema>;

export const storedObjectsAvailabilityInputSchema = internalIdentitySchema;
export type StoredObjectsAvailabilityInput = z.infer<typeof storedObjectsAvailabilityInputSchema>;
export const storedObjectsAvailabilityOutputSchema = z
  .object({ status: storedObjectLifecycleStatusSchema })
  .strict();
export type StoredObjectsAvailabilityOutput = z.infer<typeof storedObjectsAvailabilityOutputSchema>;

export const storedObjectsDeliveryInputSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
    audience: storedObjectDeliveryAudienceSchema,
  })
  .strict();
export type StoredObjectsDeliveryInput = z.infer<typeof storedObjectsDeliveryInputSchema>;
export const storedObjectsDeliveryOutputSchema = storedObjectDeliveryCapabilitySchema;
export type StoredObjectsDeliveryOutput = z.infer<typeof storedObjectsDeliveryOutputSchema>;

interface StoredObjectsInternalRpcProcedure<Input extends ZodTypeAny, Output extends ZodTypeAny> {
  readonly method: "POST";
  readonly input: Input;
  readonly output: Output;
  readonly permission: AuthzPermission;
}

/** The deliberately smaller dashboard tRPC contract. */
export const storedObjectsInternalRpc = {
  metadata: {
    method: "POST",
    input: storedObjectsMetadataInputSchema,
    output: storedObjectsMetadataOutputSchema,
    permission: "project:view",
  },
  availability: {
    method: "POST",
    input: storedObjectsAvailabilityInputSchema,
    output: storedObjectsAvailabilityOutputSchema,
    permission: "project:view",
  },
  delivery: {
    method: "POST",
    input: storedObjectsDeliveryInputSchema,
    output: storedObjectsDeliveryOutputSchema,
    permission: "project:view",
  },
} as const satisfies Record<string, StoredObjectsInternalRpcProcedure<ZodTypeAny, ZodTypeAny>>;

/**
 * The tri-state an existence probe answers with, matching what
 * `/api/files/:id` reports:
 *  - `available` — row exists and storage has the bytes
 *  - `missing`   — row exists but the blob is gone
 *  - `not_found` — no row matches
 */
export const storedObjectHeadSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), mediaType: z.string() }).strict(),
  z.object({ status: z.literal("missing"), mediaType: z.string() }).strict(),
  z.object({ status: z.literal("not_found") }).strict(),
]);
export type StoredObjectHead = z.infer<typeof storedObjectHeadSchema>;
