import { TRPCError } from "@trpc/server";
import { compare, hash } from "bcrypt";
import { z } from "zod";
import { env } from "../../../env.mjs";

import { skipPermissionCheck } from "../rbac";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { UserService } from "~/server/users/user.service";
import { revokeOtherSessionsForUser } from "~/server/better-auth/revokeSessions";
import { rateLimit } from "~/server/rateLimit";
import { getClientIp } from "~/utils/getClientIp";

export const userRouter = createTRPCRouter({
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, "Name is required"),
        email: z.string().email("Invalid email"),
        // Match the strength requirement enforced by `changePassword`
        // (min 8) and the signup form's client-side check (was min 6 —
        // updated to align). Without this, the server accepted any
        // password (even a single character) while the form rejected
        // anything under 6, leading to a server/client validation gap.
        password: z
          .string()
          .min(8, "Password must be at least 8 characters"),
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

      // Per-IP rate limit. Mirrors BetterAuth's `/sign-up/email` 20-per-hour
      // limit so the tRPC path can't be used as a side-channel for spam
      // signups (iter 45/46 of the migration audit).
      const ip = getClientIp(ctx.req) ?? "unknown";
      const limit = await rateLimit({
        key: `user.register:${ip}`,
        windowSeconds: 60 * 60,
        max: 20,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many signup attempts. Please try again later.",
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

      const newUser = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name,
            email,
          },
        });
        await tx.account.create({
          data: {
            userId: created.id,
            type: "credential",
            provider: "credential",
            providerAccountId: created.id,
            password: hashedPassword,
          },
        });
        return created;
      });

      return { id: newUser.id };
    }),
  updateLastLogin: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .mutation(async ({ ctx }) => {
      // Don't update lastLoginAt for impersonated sessions — an admin
      // browsing as another user should not overwrite that user's
      // last-login timestamp with the admin's activity.
      if (ctx.session.user.impersonator) return;

      await ctx.prisma.user.update({
        where: {
          id: ctx.session.user.id,
        },
        data: {
          lastLoginAt: new Date(),
        },
      });
    }),
  getSsoStatus: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .query(async ({ ctx }) => {
      return UserService.create(ctx.prisma).getSsoStatus({ id: ctx.session.user.id });
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
      // Wrap the count + delete in a serializable transaction. The
      // previous implementation did the count and delete as separate
      // statements with no isolation, so two concurrent unlink calls
      // (e.g. user double-clicking the X) could both observe
      // `count = 2`, both pass the "last account" guard, and both
      // delete — leaving the user with zero accounts and no way to
      // sign in. Iter 49 / bug 37 of the BetterAuth migration audit.
      const userId = ctx.session.user.id;
      await ctx.prisma.$transaction(
        async (tx) => {
          const accountCount = await tx.account.count({
            where: { userId },
          });
          if (accountCount <= 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cannot remove the last authentication method",
            });
          }
          const account = await tx.account.findFirst({
            where: { id: input.accountId, userId },
          });
          if (!account) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Account not found",
            });
          }
          await tx.account.delete({ where: { id: input.accountId } });
        },
        // Serializable isolation prevents the read of `accountCount`
        // from being a stale snapshot if a concurrent unlink commits
        // between this transaction's count and delete.
        { isolationLevel: "Serializable" },
      );

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

      // Per-user rate limit. BetterAuth's `/change-password` endpoint
      // is gated by `sensitiveSessionMiddleware` which forces recent
      // re-authentication; this tRPC mutation does NOT, so without a
      // throttle a stolen session token could be used to brute-force
      // the `currentPassword` to recover the user's plaintext (bcrypt
      // is slow but not infinite). 5 attempts per 15 minutes per user
      // mirrors `/forget-password`'s budget. Iter 49 of the migration
      // audit (bug 36).
      const limit = await rateLimit({
        key: `user.changePassword:${ctx.session.user.id}`,
        windowSeconds: 60 * 15,
        max: 5,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many password change attempts. Please try again later.",
        });
      }

      const credentialAccount = await ctx.prisma.account.findFirst({
        where: {
          userId: ctx.session.user.id,
          provider: "credential",
        },
        select: { id: true, password: true },
      });

      if (!credentialAccount?.password) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found or password not set",
        });
      }

      const passwordMatch = await compare(
        input.currentPassword,
        credentialAccount.password,
      );
      if (!passwordMatch) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      const hashedPassword = await hash(input.newPassword, 10);

      await ctx.prisma.account.update({
        where: { id: credentialAccount.id },
        data: { password: hashedPassword },
      });

      // Best practice: invalidate all OTHER sessions of this user after a
      // password change. The current tab stays logged in (the user just
      // re-authenticated by typing the current password); any other
      // device or stolen session is force-logged-out. Skip during
      // impersonation — the impersonator is the admin, and the
      // ctx.session.sessionId is the admin's session, so revoking
      // "other" sessions for the impersonated user wouldn't keep the
      // admin's tab open. In an impersonation context, password change
      // shouldn't be exposed in the UI, but be defensive.
      if (!ctx.session.user.impersonator && ctx.session.sessionId) {
        await revokeOtherSessionsForUser({
          prisma: ctx.prisma,
          userId: ctx.session.user.id,
          keepSessionId: ctx.session.sessionId,
        });
      }

      return { success: true };
    }),
  deactivate: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      // UserService.deactivate also force-revokes all the user's sessions
      // (Redis cache + DB) — see iter-24 progress notes for why.
      await UserService.create(ctx.prisma).deactivate({ id: input.userId });
      return { success: true };
    }),
  reactivate: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      await UserService.create(ctx.prisma).reactivate({ id: input.userId });
      return { success: true };
    }),
});
