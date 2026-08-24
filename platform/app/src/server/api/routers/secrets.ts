import { z } from "zod/v4";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Regex for valid secret names: uppercase letters, digits, underscores.
 * Must start with a letter.
 */
const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

const secretNameSchema = z
  .string()
  .min(1, "Secret name is required")
  .regex(
    SECRET_NAME_REGEX,
    "Secret name must contain only uppercase letters, digits, and underscores, and must start with a letter",
  );

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
    .input(z.object({ projectId: z.string() }))
    .permission("secrets:view")
    .query(({ ctx, input }) => ctx.app.secrets.list(input)),

  /**
   * Create a new secret for a project.
   * Encrypts the value before storing. Enforces name format and per-project limit.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: secretNameSchema,
        value: z
          .string()
          .min(1, "Secret value is required")
          .max(10_000, "Secret value is too long"),
      }),
    )
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
    .input(
      z.object({
        projectId: z.string(),
        secretId: z.string(),
        value: z
          .string()
          .min(1, "Secret value is required")
          .max(10_000, "Secret value is too long"),
      }),
    )
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
    .input(
      z.object({
        projectId: z.string(),
        secretId: z.string(),
      }),
    )
    .permission("secrets:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.secrets.delete({
        projectId: input.projectId,
        id: input.secretId,
      });
      return { success: true };
    }),
});
