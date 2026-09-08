/**
 * Every `secrets.*` procedure, declared once. A plaintext value travels IN on
 * `create` and `update` and is declared on no answer. The by-id writes address
 * a secret as `secretId`, the wire the browser has always called.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  createSecretInputSchema,
  listSecretsInputSchema,
  secretIdSchema,
  secretProjectIdSchema,
  secretSchema,
  secretValueSchema,
  secretWriteAcknowledgedSchema,
} from "./secret.ts";

/** The caller states the secret; the transport stamps who asked. */
export const secretTrpcCreateInputSchema = createSecretInputSchema.omit({ actorId: true });
export type SecretTrpcCreateInput = z.infer<typeof secretTrpcCreateInputSchema>;

export const secretTrpcUpdateInputSchema = z
  .object({
    projectId: secretProjectIdSchema,
    secretId: secretIdSchema,
    value: secretValueSchema,
  })
  .strict();
export type SecretTrpcUpdateInput = z.infer<typeof secretTrpcUpdateInputSchema>;

export const secretTrpcDeleteInputSchema = z
  .object({ projectId: secretProjectIdSchema, secretId: secretIdSchema })
  .strict();
export type SecretTrpcDeleteInput = z.infer<typeof secretTrpcDeleteInputSchema>;

export const secretTrpc = defineTrpcContract("secrets")
  .query("list")
  .withInput(listSecretsInputSchema)
  .withOutput(secretSchema.array())

  .mutation("create")
  .withInput(secretTrpcCreateInputSchema)
  .withOutput(secretSchema)

  .mutation("update")
  .withInput(secretTrpcUpdateInputSchema)
  .withOutput(secretWriteAcknowledgedSchema)

  .mutation("delete")
  .withInput(secretTrpcDeleteInputSchema)
  .withOutput(secretWriteAcknowledgedSchema)
  .build();
