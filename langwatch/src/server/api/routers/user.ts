import { TRPCError } from "@trpc/server";
import { compare, hash } from "bcrypt";
import { z } from "zod";
import { env } from "../../../env.mjs";

import { skipPermissionCheck } from "../permission";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const userRouter = createTRPCRouter({
  register: publicProcedure
    .input(
      z.object({
        name: z.string(),
        email: z.string(),
        password: z.string(),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      const { name, email, password } = input;

      if (env.NEXTAUTH_PROVIDER !== "email") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Direct registration is not available for this auth provider",
        });
      }

      const user = await ctx.prisma.user.findUnique({
        where: {
          email,
        },
      });

      if (user) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User already exists",
        });
      }

      const hashedPassword = await hash(password, 10);

      const newUser = await ctx.prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
      });

      return { id: newUser.id };
    }),
  updateLastLogin: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .mutation(async ({ ctx }) => {
      await ctx.prisma.user.update({
        where: {
          id: ctx.session.user.id,
        },
        data: {
          lastLoginAt: new Date(),
        },
      });
    }),
  getLinkedAccounts: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .query(async ({ ctx }) => {
      const accounts = await ctx.prisma.account.findMany({
        where: {
          userId: ctx.session.user.id,
        },
        select: {
          id: true,
          provider: true,
          providerAccountId: true,
        },
      });

      return accounts;
    }),
  unlinkAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      // First check if this is the last account
      const accounts = await ctx.prisma.account.findMany({
        where: {
          userId: ctx.session.user.id,
        },
      });

      if (accounts.length <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove the last authentication method",
        });
      }

      // Verify the account belongs to the user
      const account = await ctx.prisma.account.findFirst({
        where: {
          id: input.accountId,
          userId: ctx.session.user.id,
        },
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      // Delete the account
      await ctx.prisma.account.delete({
        where: {
          id: input.accountId,
        },
      });

      return { success: true };
    }),
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z
          .string()
          .min(8, "Password must be at least 8 characters"),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      if (env.NEXTAUTH_PROVIDER !== "email") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Password changes are not available for this auth provider",
        });
      }

      // Get the user with their password
      const user = await ctx.prisma.user.findUnique({
        where: {
          id: ctx.session.user.id,
        },
        select: {
          id: true,
          password: true,
        },
      });

      if (!user?.password) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found or password not set",
        });
      }

      // Verify current password
      const passwordMatch = await compare(input.currentPassword, user.password);
      if (!passwordMatch) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      // Hash the new password
      const hashedPassword = await hash(input.newPassword, 10);

      // Update the password
      await ctx.prisma.user.update({
        where: {
          id: ctx.session.user.id,
        },
        data: {
          password: hashedPassword,
        },
      });

      return { success: true };
    }),
});
