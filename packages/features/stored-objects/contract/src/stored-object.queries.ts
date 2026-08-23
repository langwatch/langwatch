import type { AuthzPermission } from "@langwatch/authz";
import { z, type ZodTypeAny } from "zod";
import { storedObjectDeliveryAudienceSchema } from "./audiences";
import { storedObjectIdSchema, storedObjectProjectIdSchema } from "./ids";
import {
  storedObjectLifecycleStatusSchema,
  storedObjectMetadataSchema,
} from "./metadata";
import { storedObjectDeliveryCapabilitySchema } from "./references";

const internalIdentitySchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
  })
  .strict();

export const storedObjectsMetadataInputSchema = internalIdentitySchema;
export type StoredObjectsMetadataInput = z.infer<
  typeof storedObjectsMetadataInputSchema
>;
export const storedObjectsMetadataOutputSchema = storedObjectMetadataSchema;
export type StoredObjectsMetadataOutput = z.infer<
  typeof storedObjectsMetadataOutputSchema
>;

export const storedObjectsAvailabilityInputSchema = internalIdentitySchema;
export type StoredObjectsAvailabilityInput = z.infer<
  typeof storedObjectsAvailabilityInputSchema
>;
export const storedObjectsAvailabilityOutputSchema = z
  .object({ status: storedObjectLifecycleStatusSchema })
  .strict();
export type StoredObjectsAvailabilityOutput = z.infer<
  typeof storedObjectsAvailabilityOutputSchema
>;

export const storedObjectsDeliveryInputSchema = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
    audience: storedObjectDeliveryAudienceSchema,
  })
  .strict();
export type StoredObjectsDeliveryInput = z.infer<
  typeof storedObjectsDeliveryInputSchema
>;
export const storedObjectsDeliveryOutputSchema =
  storedObjectDeliveryCapabilitySchema;
export type StoredObjectsDeliveryOutput = z.infer<
  typeof storedObjectsDeliveryOutputSchema
>;

interface StoredObjectsInternalRpcProcedure<
  Input extends ZodTypeAny,
  Output extends ZodTypeAny,
> {
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
} as const satisfies Record<
  string,
  StoredObjectsInternalRpcProcedure<ZodTypeAny, ZodTypeAny>
>;
