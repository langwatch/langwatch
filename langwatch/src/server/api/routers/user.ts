import { TRPCError } from "@trpc/server";
import { hash } from "bcrypt";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

import { skipPermissionCheck } from "../permission";
import { env } from "../../../env.mjs";
import { usageStatsQueue } from "~/server/background/queues/usageStatsQueue";

export const userRouter = createTRPCRouter({
  register: publicProcedure
    .input(
      z.object({
        name: z.string(),
        email: z.string(),
        password: z.string(),
      })
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

      // Add usage stats job for the new user
      const instanceId = `${newUser.name}__${newUser.id}`;
      await usageStatsQueue.add(
        "usage_stats",
        {
          instance_id: instanceId,
          timestamp: Date.now(),
        },
        {
          jobId: `usage_stats_${instanceId}_${
            new Date().toISOString().split("T")[0]
          }`,
        }
      );

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
      })
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
});
