import type { AuthzPermission } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z, type ZodTypeAny } from "zod";

import { storedObjectDeliveryAudienceSchema } from "./audiences.ts";
import {
  storedObjectGenerationSchema,
  storedObjectIdempotencyKeySchema,
  storedObjectIdSchema,
  storedObjectProjectIdSchema,
} from "./ids.ts";
import { storedObjectMetadataSchema, storedObjectTimestampSchema } from "./metadata.ts";
import { storedObjectDeliveryCapabilitySchema } from "./references.ts";
import {
  storedObjectsConfirmUploadInputSchema,
  storedObjectsConfirmUploadOutputSchema,
  storedObjectsCreateUploadInputSchema,
  storedObjectsCreateUploadOutputSchema,
} from "./uploads.ts";

const storedObjectsGetInputSchemaDefinition = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
    audience: storedObjectDeliveryAudienceSchema,
  })
  .strict();
export interface StoredObjectsGetInputSchema extends Named<
  typeof storedObjectsGetInputSchemaDefinition
> {}
export const storedObjectsGetInputSchema: StoredObjectsGetInputSchema =
  storedObjectsGetInputSchemaDefinition;
export type StoredObjectsGetInput = z.infer<typeof storedObjectsGetInputSchema>;

const storedObjectsGetOutputSchemaDefinition = z
  .object({
    metadata: storedObjectMetadataSchema,
    capability: storedObjectDeliveryCapabilitySchema,
  })
  .strict();
export interface StoredObjectsGetOutputSchema extends Named<
  typeof storedObjectsGetOutputSchemaDefinition
> {}
export const storedObjectsGetOutputSchema: StoredObjectsGetOutputSchema =
  storedObjectsGetOutputSchemaDefinition;
export type StoredObjectsGetOutput = z.infer<typeof storedObjectsGetOutputSchema>;

const storedObjectsDeleteInputSchemaDefinition = z
  .object({
    projectId: storedObjectProjectIdSchema,
    id: storedObjectIdSchema,
    idempotencyKey: storedObjectIdempotencyKeySchema,
  })
  .strict();
export interface StoredObjectsDeleteInputSchema extends Named<
  typeof storedObjectsDeleteInputSchemaDefinition
> {}
export const storedObjectsDeleteInputSchema: StoredObjectsDeleteInputSchema =
  storedObjectsDeleteInputSchemaDefinition;
export type StoredObjectsDeleteInput = z.infer<typeof storedObjectsDeleteInputSchema>;

const storedObjectsDeleteOutputSchemaDefinition = z
  .object({
    id: storedObjectIdSchema,
    generation: storedObjectGenerationSchema,
    deletedAt: storedObjectTimestampSchema,
  })
  .strict();
export interface StoredObjectsDeleteOutputSchema extends Named<
  typeof storedObjectsDeleteOutputSchemaDefinition
> {}
export const storedObjectsDeleteOutputSchema: StoredObjectsDeleteOutputSchema =
  storedObjectsDeleteOutputSchemaDefinition;
export type StoredObjectsDeleteOutput = z.infer<typeof storedObjectsDeleteOutputSchema>;

export interface StoredObjectsRpcProcedure<Input extends ZodTypeAny, Output extends ZodTypeAny> {
  readonly method: "POST";
  readonly input: Input;
  readonly output: Output;
  readonly permission: AuthzPermission;
  readonly audienceProof?: true;
}

function publicRpcContract(): {
  readonly createUpload: {
    readonly method: "POST";
    readonly input: typeof storedObjectsCreateUploadInputSchema;
    readonly output: typeof storedObjectsCreateUploadOutputSchema;
    readonly permission: "project:update";
  };
  readonly confirmUpload: {
    readonly method: "POST";
    readonly input: typeof storedObjectsConfirmUploadInputSchema;
    readonly output: typeof storedObjectsConfirmUploadOutputSchema;
    readonly permission: "project:update";
  };
  readonly get: {
    readonly method: "POST";
    readonly input: typeof storedObjectsGetInputSchema;
    readonly output: typeof storedObjectsGetOutputSchema;
    readonly permission: "project:view";
    readonly audienceProof: true;
  };
  readonly delete: {
    readonly method: "POST";
    readonly input: typeof storedObjectsDeleteInputSchema;
    readonly output: typeof storedObjectsDeleteOutputSchema;
    readonly permission: "project:manage";
  };
} {
  return {
    createUpload: {
      method: "POST",
      input: storedObjectsCreateUploadInputSchema,
      output: storedObjectsCreateUploadOutputSchema,
      permission: "project:update",
    },
    confirmUpload: {
      method: "POST",
      input: storedObjectsConfirmUploadInputSchema,
      output: storedObjectsConfirmUploadOutputSchema,
      permission: "project:update",
    },
    get: {
      method: "POST",
      input: storedObjectsGetInputSchema,
      output: storedObjectsGetOutputSchema,
      permission: "project:view",
      audienceProof: true,
    },
    delete: {
      method: "POST",
      input: storedObjectsDeleteInputSchema,
      output: storedObjectsDeleteOutputSchema,
      permission: "project:manage",
    },
  } as const satisfies Record<string, StoredObjectsRpcProcedure<ZodTypeAny, ZodTypeAny>>;
}

/** Portable declarations consumed by the unified API registration adapter. */
export const storedObjectsPublicRpc = publicRpcContract();
