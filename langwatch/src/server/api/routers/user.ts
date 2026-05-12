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
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import {
  Auth0ApiError,
  changeAuth0Password,
} from "~/server/auth0/passwordService";

export const userRouter = createTRPCRouter({
  /**
   * Whether the current user is a platform admin (email listed in ADMIN_EMAILS).
   * Exposed so the client can decide whether to render admin-only UI surfaces
   * like the OPS Backoffice sidebar entry. This is NOT an authorization gate —
   * server-side admin routes enforce access independently via isAdmin.
   */
  isAdmin: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .query(({ ctx }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      return { isAdmin: checkIsAdmin({ email: user.email }) };
    }),
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
        // Required for both modes — the user must re-confirm their
        // current password to change it. Defends against a stolen
        // session lock-out: even with a valid session cookie, an
        // attacker can't change the password without knowing the
        // existing one.
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z
          .string()
          .min(8, "Password must be at least 8 characters"),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ ctx, input }) => {
      if (
        env.NEXTAUTH_PROVIDER !== "email" &&
        env.NEXTAUTH_PROVIDER !== "auth0"
      ) {
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
      // audit (bug 36). Applies to the Auth0 path too — both to
      // throttle brute-force against the Auth0 Authentication API
      // and to avoid hammering Auth0 rate limits.
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

      if (env.NEXTAUTH_PROVIDER === "auth0") {
        // Only the Auth0 database connection (`auth0|<id>` providerAccountId)
        // has a password we can update via the Management API. Social
        // identities linked through Auth0 (google-oauth2|..., github|...,
        // windowslive|...) are managed by their upstream IdPs — calling
        // PATCH /api/v2/users with `connection: "Username-Password-Authentication"`
        // on those would fail.
        const auth0Account = await ctx.prisma.account.findFirst({
          where: {
            userId: ctx.session.user.id,
            provider: "auth0",
            providerAccountId: { startsWith: "auth0|" },
          },
          select: { providerAccountId: true },
        });

        if (!auth0Account) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "No Auth0 database (Email/Password) account is linked to this user. Password changes are only supported for that sign-in method.",
          });
        }

        if (!ctx.session.user.email) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Authenticated session is missing an email",
          });
        }

        try {
          const result = await changeAuth0Password({
            email: ctx.session.user.email,
            auth0UserId: auth0Account.providerAccountId,
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
          });
          if (!result.ok) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Current password is incorrect",
            });
          }
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          if (error instanceof Auth0ApiError) {
            if (error.code === "weak_password") {
              // Auth0 tenant policy rejected the new password — show its
              // message verbatim so the user knows what to fix.
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: error.message,
              });
            }
            if (error.code === "insufficient_scope") {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message:
                  "Auth0 is not authorized to update users. Ask an administrator to enable the update:users scope on the Auth0 Management M2M application.",
              });
            }
            if (error.code === "password_grant_not_enabled") {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message:
                  "Auth0 Password grant is not enabled on the Management M2M application. Ask an administrator to enable it under that application's Advanced Settings → Grant Types.",
              });
            }
            if (error.code === "not_configured") {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message:
                  "Auth0 is not configured on the server. Set AUTH0_ISSUER plus AUTH0_MGMT_CLIENT_ID/SECRET (or AUTH0_CLIENT_ID/SECRET).",
              });
            }
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message:
                "Could not update password with Auth0. Please try again later.",
            });
          }
          throw error;
        }

        // Auth0's OIDC sessions are managed by the Auth0 tenant, but the
        // LangWatch *app* session is a BetterAuth row in our DB and is NOT
        // invalidated by the Management API password change. Revoke other
        // devices' app sessions so a stolen session token cannot outlive a
        // password rotation. Same impersonation safeguard as the email path.
        if (!ctx.session.user.impersonator && ctx.session.sessionId) {
          await revokeOtherSessionsForUser({
            prisma: ctx.prisma,
            userId: ctx.session.user.id,
            keepSessionId: ctx.session.sessionId,
          });
        }
        return { success: true };
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
