import { TRPCError } from "@trpc/server";
import { hash } from "bcrypt";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

import { skipPermissionCheck } from "../permission";
import { env } from "../../../env.mjs";

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
});
