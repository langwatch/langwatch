import {
  createSecretInputSchema,
  deleteSecretInputSchema,
  listSecretsInputSchema,
  secretIdSchema,
  secretProjectIdSchema,
  secretValueSchema,
} from "@langwatch/secret-contract";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const legacyUpdateInputSchema = z
  .object({
    projectId: secretProjectIdSchema,
    secretId: secretIdSchema,
    value: secretValueSchema,
  })
  .strict();

const legacyDeleteInputSchema = deleteSecretInputSchema
  .omit({ id: true })
  .extend({ secretId: secretIdSchema });

/**
 * Secrets router
 * Provides CRUD endpoints for managing project secrets (API keys, tokens, etc.).
 * Secret values are encrypted at rest and never returned to the client.
 */
export const secretsRouter = createTRPCRouter({
  /**
   * List all secrets for a project (masked values).
   * Returns metadata only -- never the encrypted value.
   *
   * Product-owned rows (RESERVED_PROJECT_SECRET_NAMES) are excluded: the
   * customer did not create them and cannot safely change them, so listing
   * them only offers a way to break the feature that owns them.
   */
  list: protectedProcedure
    .input(listSecretsInputSchema)
    .permission("secrets:view")
    .query(({ ctx, input }) => ctx.app.secrets.list(input)),

  /**
   * Create a new secret for a project.
   * Encrypts the value before storing. Enforces name format and per-project limit.
   */
  create: protectedProcedure
    .input(createSecretInputSchema.omit({ actorId: true }))
    .permission("secrets:manage")
    .mutation(({ ctx, input }) =>
      ctx.app.secrets.create({
        ...input,
        actorId: ctx.session.user.id,
      }),
    ),

  /**
   * Update a secret's value.
   * Encrypts the new value and records who made the change.
   */
  update: protectedProcedure
    .input(legacyUpdateInputSchema)
    .permission("secrets:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.secrets.update({
        projectId: input.projectId,
        id: input.secretId,
        value: input.value,
        actorId: ctx.session.user.id,
      });
      return { success: true };
    }),

  /**
   * Delete a secret.
   * Verifies the secret belongs to the project before deleting.
   */
  delete: protectedProcedure
    .input(legacyDeleteInputSchema)
    .permission("secrets:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.secrets.delete({
        projectId: input.projectId,
        id: input.secretId,
      });
      return { success: true };
    }),
});
