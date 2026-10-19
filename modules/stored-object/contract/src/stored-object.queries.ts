import type { AuthzPermission } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
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
const storedObjectsAvailabilityOutputSchemaDefinition = z
  .object({ status: storedObjectLifecycleStatusSchema })
  .strict();
export interface StoredObjectsAvailabilityOutputSchema extends Named<
  typeof storedObjectsAvailabilityOutputSchemaDefinition
> {}
export const storedObjectsAvailabilityOutputSchema: StoredObjectsAvailabilityOutputSchema =
  storedObjectsAvailabilityOutputSchemaDefinition;
export type StoredObjectsAvailabilityOutput = z.infer<typeof storedObjectsAvailabilityOutputSchema>;

const storedObjectsDeliveryInputSchemaDefinition = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
    audience: storedObjectDeliveryAudienceSchema,
  })
  .strict();
export interface StoredObjectsDeliveryInputSchema extends Named<
  typeof storedObjectsDeliveryInputSchemaDefinition
> {}
export const storedObjectsDeliveryInputSchema: StoredObjectsDeliveryInputSchema =
  storedObjectsDeliveryInputSchemaDefinition;
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
 * Server capability for resolving a historical id-only file URL to its owner.
 * It is deliberately separate from ordinary project-scoped Stored Object I/O.
 */
export abstract class StoredObjectOwnerResolver {
  /** Throws `StoredObjectNotFoundError` when no healthy instance holds the id. */
  abstract getOwner(input: { id: string }): Promise<{ projectId: string }>;
}

/** The cross-tenant resolver could not rule out an owner during a partial outage. */
export class StoredObjectOwnerLookupUnavailableError extends Error {
  readonly failedTargets: string[];

  constructor(failedTargets: string[]) {
    super(
      `cross-tenant owner lookup degraded: ${failedTargets.length} instance(s) failed (${failedTargets.join(", ")}); no hit on any healthy instance`,
    );
    this.name = "StoredObjectOwnerLookupUnavailableError";
    this.failedTargets = failedTargets;
  }
}
