/**
 * Every `secrets.*` procedure, declared once. A plaintext value travels IN on
 * `create` and `update` and is declared on no answer. The by-id writes address
 * a secret as `secretId`, the wire the browser has always called.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { revealedSecretSchema, revealOnceInputSchema } from "./one-time-reveal.ts";
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
const secretTrpcCreateInputSchemaDefinition = createSecretInputSchema.omit({
  actorId: true,
});
export interface SecretTrpcCreateInputSchema extends Named<
  typeof secretTrpcCreateInputSchemaDefinition
> {}
export const secretTrpcCreateInputSchema: SecretTrpcCreateInputSchema =
  secretTrpcCreateInputSchemaDefinition;
export type SecretTrpcCreateInput = z.infer<typeof secretTrpcCreateInputSchema>;

const secretTrpcUpdateInputSchemaDefinition = z
  .object({
    projectId: secretProjectIdSchema,
    secretId: secretIdSchema,
    value: secretValueSchema,
  })
  .strict();
export interface SecretTrpcUpdateInputSchema extends Named<
  typeof secretTrpcUpdateInputSchemaDefinition
> {}
export const secretTrpcUpdateInputSchema: SecretTrpcUpdateInputSchema =
  secretTrpcUpdateInputSchemaDefinition;
export type SecretTrpcUpdateInput = z.infer<typeof secretTrpcUpdateInputSchema>;

const secretTrpcDeleteInputSchemaDefinition = z
  .object({ projectId: secretProjectIdSchema, secretId: secretIdSchema })
  .strict();
export interface SecretTrpcDeleteInputSchema extends Named<
  typeof secretTrpcDeleteInputSchemaDefinition
> {}
export const secretTrpcDeleteInputSchema: SecretTrpcDeleteInputSchema =
  secretTrpcDeleteInputSchemaDefinition;
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

  // A mutation rather than a query: reading a reveal DESTROYS it, and a query
  // is a thing a client may retry, prefetch or cache.
  .mutation("revealOnce")
  .withInput(revealOnceInputSchema)
  .withOutput(revealedSecretSchema)
  .build();
