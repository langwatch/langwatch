import type { AuthzPermission } from "@langwatch/authz-contract";
import { z, type ZodTypeAny } from "zod";
import { storedObjectDeliveryAudienceSchema } from "./audiences";
import {
  storedObjectGenerationSchema,
  storedObjectIdempotencyKeySchema,
  storedObjectIdSchema,
} from "./ids";
import {
  storedObjectMetadataSchema,
  storedObjectTimestampSchema,
} from "./metadata";
import { storedObjectDeliveryCapabilitySchema } from "./references";
import {
  createStoredObjectsCreateUploadInputSchema,
  storedObjectsConfirmUploadInputSchema,
  storedObjectsConfirmUploadOutputSchema,
  storedObjectsCreateUploadInputSchema,
  storedObjectsCreateUploadOutputSchema,
} from "./uploads";

export const storedObjectsGetInputSchema = z
  .object({
    id: storedObjectIdSchema,
    audience: storedObjectDeliveryAudienceSchema,
  })
  .strict();
export type StoredObjectsGetInput = z.infer<typeof storedObjectsGetInputSchema>;

export const storedObjectsGetOutputSchema = z
  .object({
    metadata: storedObjectMetadataSchema,
    capability: storedObjectDeliveryCapabilitySchema,
  })
  .strict();
export type StoredObjectsGetOutput = z.infer<
  typeof storedObjectsGetOutputSchema
>;

export const storedObjectsDeleteInputSchema = z
  .object({
    id: storedObjectIdSchema,
    idempotencyKey: storedObjectIdempotencyKeySchema,
  })
  .strict();
export type StoredObjectsDeleteInput = z.infer<
  typeof storedObjectsDeleteInputSchema
>;

export const storedObjectsDeleteOutputSchema = z
  .object({
    id: storedObjectIdSchema,
    generation: storedObjectGenerationSchema,
    deletedAt: storedObjectTimestampSchema,
  })
  .strict();
export type StoredObjectsDeleteOutput = z.infer<
  typeof storedObjectsDeleteOutputSchema
>;

export interface StoredObjectsRpcProcedure<
  Input extends ZodTypeAny,
  Output extends ZodTypeAny,
> {
  readonly method: "POST";
  readonly input: Input;
  readonly output: Output;
  readonly permission: AuthzPermission;
  readonly audienceProof?: true;
}

function publicRpcContract(
  createUploadInput: typeof storedObjectsCreateUploadInputSchema,
) {
  return {
    createUpload: {
      method: "POST",
      input: createUploadInput,
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
  } as const satisfies Record<
    string,
    StoredObjectsRpcProcedure<ZodTypeAny, ZodTypeAny>
  >;
}

/** Portable declarations consumed by the unified API registration adapter. */
export const storedObjectsPublicRpc = publicRpcContract(
  storedObjectsCreateUploadInputSchema,
);

/** Same declarations with the runtime's semantic maximum embedded in input validation. */
export function createStoredObjectsPublicRpc(maximumUploadBytes: number) {
  return publicRpcContract(
    createStoredObjectsCreateUploadInputSchema(maximumUploadBytes),
  );
}
