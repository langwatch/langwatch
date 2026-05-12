import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { encrypt } from "~/utils/encryption";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const MAX_SECRETS_PER_PROJECT = 50;

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
    "Secret name must contain only uppercase letters, digits, and underscores, and must start with a letter"
  );

/**
 * Fields to select when returning secrets to the client.
 * Deliberately excludes `encryptedValue` to prevent secret leakage.
 */
const secretSelectWithoutValue = {
  id: true,
  projectId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} as const;

/**
 * Secrets router
 * Provides CRUD endpoints for managing project secrets (API keys, tokens, etc.).
 * Secret values are encrypted at rest and never returned to the client.
 */
export const secretsRouter = createTRPCRouter({
  /**
   * List all secrets for a project (masked values).
   * Returns metadata only -- never the encrypted value.
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("secrets:view"))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.projectSecret.findMany({
        where: { projectId: input.projectId },
        select: secretSelectWithoutValue,
        orderBy: { name: "asc" },
      });
    }),

  /**
   * Create a new secret for a project.
   * Encrypts the value before storing. Enforces name format and per-project limit.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: secretNameSchema,
        value: z.string().min(1, "Secret value is required").max(10_000, "Secret value is too long"),
      })
    )
    .use(checkProjectPermission("secrets:manage"))
    .mutation(async ({ ctx, input }) => {
      const count = await ctx.prisma.projectSecret.count({
        where: { projectId: input.projectId },
      });

      if (count >= MAX_SECRETS_PER_PROJECT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Maximum of ${MAX_SECRETS_PER_PROJECT} secrets per project reached`,
        });
      }

      const encryptedValue = encrypt(input.value);
      const userId = ctx.session.user.id;

      try {
        return await ctx.prisma.projectSecret.create({
          data: {
            projectId: input.projectId,
            name: input.name,
            encryptedValue,
            createdById: userId,
            updatedById: userId,
          },
          select: secretSelectWithoutValue,
        });
      } catch (error) {
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A secret with the name "${input.name}" already exists in this project`,
          });
        }
        throw error;
      }
    }),

  /**
   * Update a secret's value.
   * Encrypts the new value and records who made the change.
   */
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        secretId: z.string(),
        value: z.string().min(1, "Secret value is required").max(10_000, "Secret value is too long"),
      })
    )
    .use(checkProjectPermission("secrets:manage"))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.projectSecret.findFirst({
        where: { id: input.secretId, projectId: input.projectId },
        select: { id: true },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found",
        });
      }

      const encryptedValue = encrypt(input.value);

      await ctx.prisma.projectSecret.update({
        where: { id: input.secretId, projectId: input.projectId },
        data: {
          encryptedValue,
          updatedById: ctx.session.user.id,
        },
        select: { id: true },
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
      })
    )
    .use(checkProjectPermission("secrets:manage"))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.projectSecret.findFirst({
        where: { id: input.secretId, projectId: input.projectId },
        select: { id: true },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Secret not found",
        });
      }

      await ctx.prisma.projectSecret.delete({
        where: { id: input.secretId, projectId: input.projectId },
      });

      return { success: true };
    }),
});
