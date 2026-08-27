import { CliBootstrapService } from "@ee/governance/services/cliBootstrap.service";
import { findHiddenGovernanceProject } from "@ee/governance/services/governanceProject.service";
import { PersonalUsageService } from "@ee/governance/services/personalUsage.service";
import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { RoutingPolicyService } from "@ee/governance/services/routingPolicy.service";
import { resolveAuthProvider } from "@ee/sso/sso-gate";
import { ValidationError } from "@langwatch/handled-error";
import {
  IdentityDetachStrandsUserError,
  passwordProblem,
} from "@langwatch/identity";
import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { compare, hash } from "bcrypt";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { signUpVerification } from "~/server/app-layer/identity/runtime";
import { deploymentOffersTwoStepVerification } from "~/server/app-layer/identity/signin-method-policy";
import { NoAdminConfiguredError } from "~/server/app-layer/organizations/errors";
import {
  AuthRateLimitedError,
  DirectRegistrationUnavailableError,
} from "~/server/auth/errors";
import {
  Auth0ApiError,
  changeAuth0Password,
} from "~/server/auth0/passwordService";
import { revokeOtherSessionsForUser } from "~/server/better-auth/revokeSessions";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { BudgetOverviewService } from "~/server/gateway/budgetOverview.service";
import { sendBudgetIncreaseRequestEmail } from "~/server/mailer/budgetIncreaseRequestEmail";
import { resolveOrgAdminEmail } from "~/server/organizations/resolveOrgAdminEmail";
import { resolveSupportContact } from "~/server/organizations/resolveSupportContact";
import { rateLimit } from "~/server/rateLimit";
import { AvatarRateLimitedError } from "~/server/user-avatar/avatar";
import { UserAvatarService } from "~/server/user-avatar/avatar.service";
import { createCredentialUser } from "~/server/users/credential-user";
import { EmailAlreadyRegisteredError } from "~/server/users/errors";
import { UserService } from "~/server/users/user.service";
import { getClientIp } from "~/utils/getClientIp";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { env } from "../../../env.mjs";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

const logger = createLogger("langwatch:user-router");

/**
 * How long until a rate-limit budget refills, in whole seconds, never
 * negative. Carried on the refusal so a screen can count down rather than say
 * "later" and leave somebody guessing.
 */
function secondsUntil(resetAt: number): number {
  return Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
}

/**
 * How long "not now" lasts (ADR-120). Long enough that the offer reads as an
 * offer rather than a nag, short enough that somebody who declined on the day
 * they signed up is asked again once they have something worth protecting.
 */
const SECURE_ACCOUNT_NUDGE_INTERVAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

/**
 * A display name, as `user.updateName` will accept it.
 *
 * Trimmed BEFORE the length checks, so "   " is a name of length zero and is
 * refused rather than stored as a blank that renders as an unexplained gap in
 * every member list. Exported so the shape is testable on its own, without
 * standing a router up around it.
 *
 * Spec: specs/settings/profile.feature
 */
export const PROFILE_NAME_SCHEMA = z.string().trim().min(1).max(120);

export const userRouter = createTRPCRouter({
  getTraceExplorerTourPreference: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .query(async ({ ctx }) => {
      const userId = ctx.session.user.impersonator?.id ?? ctx.session.user.id;
      const user = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tracesExplorerTourDismissedAt: true },
      });

      return {
        dismissed: user.tracesExplorerTourDismissedAt !== null,
        dismissedAt: user.tracesExplorerTourDismissedAt,
      };
    }),
  dismissTraceExplorerTour: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.impersonator?.id ?? ctx.session.user.id;
      const user = await ctx.prisma.user.update({
        where: { id: userId },
        data: { tracesExplorerTourDismissedAt: new Date() },
        select: { tracesExplorerTourDismissedAt: true },
      });

      return {
        dismissed: true as const,
        dismissedAt: user.tracesExplorerTourDismissedAt,
      };
    }),
  /**
   * Whether the current user is a platform admin (email listed in ADMIN_EMAILS).
   * Exposed so the client can decide whether to render admin-only UI surfaces
   * like the OPS Backoffice sidebar entry. This is NOT an authorization gate —
   * server-side admin routes enforce access independently via isAdmin.
   */
  isAdmin: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .query(({ ctx }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      return { isAdmin: checkIsAdmin({ email: user.email }) };
    }),
  register: publicProcedure
    .input(
      z.object({
        // Optional: the auth screens does not ask. Onboarding does, in a place
        // where the question is worth a field. The legacy sign-up page still
        // sends one, so it is taken when it comes.
        name: z.string().min(1, "Name is required").optional(),
        email: z.string().email("Invalid email"),
        // Length only here; the POLICY is checked in the body so its refusal
        // can carry `meta.fieldErrors` and land on the field the person is
        // looking at. An input-schema rejection arrives as a tRPC parse error
        // with no field to hang on.
        password: z.string().min(1),
        /**
         * The single-use proof that an emailed link already confirmed this
         * address, minted by `completeSignUpVerification` for an address that
         * had no account behind it. Where it checks out, the account is born
         * confirmed and no second link is sent.
         */
        addressProof: z.string().min(1).optional(),
      }),
    )
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx, input }) => {
      const { name, password } = input;

      // The same rules the form ran, from the same module, so the two cannot
      // drift into accepting different passwords. Carried as `fieldErrors` so
      // the refusal lands on the password box rather than in a banner over it.
      const problem = passwordProblem(password);
      if (problem) {
        throw new ValidationError(problem, {
          meta: { fieldErrors: { password: [problem] } },
        });
      }
      // BetterAuth lowercases the email on every one of its lookups and
      // writes, and sign-in goes through BetterAuth. An account stored as
      // typed, capitals and all, is therefore one that sign-in can never find
      // again, no matter the password. Store the shape sign-in will search
      // for. Customer report: onboarding signups that autocapitalised the
      // address were permanently locked out with "User already exists".
      const email = input.email.toLowerCase();

      // Keyed off the RESOLVED provider, not the raw env: on an SSO-capable
      // deployment with no genuine license the platform gate coerces the
      // deployment to email mode (ADR-027 Decision 4), and this tRPC path is
      // the signup form's actual backend — blocking it would kill the
      // fresh-signup recovery route (Decision 5c).
      if ((await resolveAuthProvider()) !== "email") {
        throw new DirectRegistrationUnavailableError();
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
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      // Case-insensitive on purpose: rows written before the lowercasing
      // above (or seeded by other means) may carry capitals, and minting a
      // case-twin beside one would leave two Users answering for one human.
      const user = await ctx.prisma.user.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
        },
      });

      if (user) {
        throw new EmailAlreadyRegisteredError();
      }

      const newUser = await createCredentialUser({
        prisma: ctx.prisma,
        name: name ?? null,
        email,
        passwordHash: await hash(password, 10),
      });

      // An address an emailed link already proved does not get asked again.
      // The proof is spent here, so it confirms exactly one account, and it
      // is checked against THIS address, so a proof for one address cannot
      // confirm another. Anything that does not check out simply falls
      // through to the ordinary link below.
      const verification = signUpVerification();
      if (
        input.addressProof &&
        (await verification.claimAddressProof({
          token: input.addressProof,
          email,
        }))
      ) {
        await verification.markAddressConfirmed({ email });
        return { id: newUser.id };
      }

      // The confirmation link, sent from HERE (ADR-117 §6). Sign-up creates
      // the account but opens no session: the address is confirmed before
      // anybody gets in, so there is no session for the screen to send this
      // from. The alternative — a public "send a confirmation to this
      // address" — is a mailer pointed at anything anybody types, and the
      // guard that keeps `requestSignUpVerification` honest (refusing an
      // address that already has an account) is exactly the guard such an
      // endpoint could not have, since by this line the account is the point.
      //
      // Sending it from the call that CREATED the account closes that: the
      // only address reachable is the one just registered, and the mail is a
      // consequence of the write rather than a favour done for a caller.
      //
      // Awaited, unlike the passkey path's, because nothing navigates behind
      // it and the screen it returns to is the one that says a link is on its
      // way. A mailer that is down must not lose the account, though, so a
      // failure is logged and swallowed: the account exists, and the way on
      // is the "send it again" the next screen offers.
      try {
        await verification.requestVerification({ email });
      } catch (failure) {
        logger.warn(
          { error: failure, userId: newUser.id },
          "sign-up could not send the address confirmation",
        );
      }

      return { id: newUser.id };
    }),
  updateLastLogin: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
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
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .query(async ({ ctx }) => {
      return UserService.create(ctx.prisma).getSsoStatus({
        id: ctx.session.user.id,
      });
    }),
  getAccountInfo: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .query(async ({ ctx }) => {
      return UserService.create(ctx.prisma).getAccountInfo({
        id: ctx.session.user.id,
      });
    }),

  /**
   * Sets the caller's own display name — the one a member list, a comment and
   * an audit entry name them by.
   *
   * The name was writable by sign-up, by the identity provider and by a
   * back-office operator, and by nobody else: somebody whose directory sent
   * "asmith" was stuck as "asmith" to every colleague who read a member list.
   *
   * A name the directory owns is still the caller's to set. The next push may
   * overwrite it; refusing the edit would not change that and would only take
   * away the one thing they could do about it in the meantime.
   *
   * The schema trims first and requires something left, so a name that is
   * nothing but whitespace is refused at the boundary rather than persisted
   * as a blank that renders as an unexplained gap wherever a person is
   * listed. Sessions are NOT revoked: `updateProfile` reserves that for an
   * email change, and a cosmetic edit is no reason to sign somebody out.
   *
   * Spec: specs/settings/profile.feature
   */
  updateName: protectedProcedure
    .input(z.object({ name: PROFILE_NAME_SCHEMA }))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx, input }) => {
      await UserService.create(ctx.prisma).updateProfile({
        id: ctx.session.user.id,
        name: input.name,
      });
      return { name: input.name };
    }),
  getLinkedAccounts: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
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
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
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
            // The same refusal the detach guard raises, so the words the
            // caller reads come from the code-keyed presentation registry
            // rather than from a sentence written here. A raw message would
            // reach the screen as "unknown error" (#5984).
            throw new IdentityDetachStrandsUserError(
              `unlink_account: ${input.accountId} is the last account of user ${userId}`,
            );
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
  /**
   * What this person could do to secure their account right now, and whether
   * to say so (ADR-120, extended at D06).
   *
   * ONE offer covering both halves, not two nudges racing each other. A
   * person is asked once about the account rather than once about a passkey
   * and again about two-step verification, because two dialogs on the way in
   * is a nag whatever each one says on its own — and because somebody who
   * declines the first has answered the question the second would ask.
   *
   * Each half keeps its own gate and its own reason to be absent:
   *
   *   - the passkey half is gated on the sign-in screens actually TAKING a
   *     passkey, not just on the plugin being mounted (a deployment on the
   *     legacy auth screens would otherwise nudge people into minting a
   *     credential no screen has a button for), and never appears for
   *     somebody who already holds one — whatever they signed in with today;
   *   - the two-step half is gated on `MFA_ENROLLMENT_OPEN`, so with the flag
   *     off nothing about it is offered, and never appears for somebody who
   *     has already set one up.
   *
   * The interval lives on the account rather than in browser storage, so a
   * new device does not restart the count and the 30 days actually mean 30
   * days. One dismissal governs the WHOLE nudge, which is what makes it one
   * question rather than two.
   */
  secureAccountNudge: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .query(async ({ ctx }) => {
      const twoStepOffered = deploymentOffersTwoStepVerification();

      const [passkeys, user] = await Promise.all([
        ctx.prisma.passkey.count({ where: { userId: ctx.session.user.id } }),
        ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { passkeyNudgeDismissedAt: true, twoFactorEnabled: true },
        }),
      ]);

      const passkey = passkeys === 0;
      const twoStep = twoStepOffered && !(user?.twoFactorEnabled ?? false);
      if (!passkey && !twoStep) {
        return { offer: false, passkey: false, twoStep: false };
      }

      // The column keeps its name. It has always dated one dismissal of one
      // offer, and it still does — the offer simply says more than it used
      // to. Renaming it would rewrite every existing dismissal's meaning for
      // no gain a reader of this code can see.
      const dismissedAt = user?.passkeyNudgeDismissedAt;
      const askAgainAfter = dismissedAt
        ? dismissedAt.getTime() + SECURE_ACCOUNT_NUDGE_INTERVAL_DAYS * DAY_MS
        : 0;
      return { offer: Date.now() >= askAgainAfter, passkey, twoStep };
    }),
  /**
   * "Not now". Dated rather than flagged, because the offer comes back — a
   * flag would make one dismissal permanent, and somebody who declines on the
   * day they sign up is not somebody who never wants to secure their account.
   *
   * One dismissal covers both halves. Declining is an answer to "shall we
   * make this account harder to take over", and asking again about the other
   * half tomorrow would be answering a question nobody asked.
   */
  dismissSecureAccountNudge: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx }) => {
      await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: { passkeyNudgeDismissedAt: new Date() },
      });
      return { success: true };
    }),
  /**
   * Whether the session user can sign in with a password.
   *
   * The settings page needs it to know which of two things to offer: changing
   * a password, or setting a first one. Passkey sign-up and SSO both produce
   * accounts with no password at all, and offering "Change password" to
   * somebody who has none is an offer that can only fail.
   */
  hasPassword: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .query(async ({ ctx }) => {
      return {
        hasPassword: await UserService.create(ctx.prisma).hasPassword({
          id: ctx.session.user.id,
        }),
      };
    }),
  /**
   * Set a FIRST password, for an account that has none.
   *
   * A passkey is the better credential and this does not argue otherwise. But
   * an account whose only way in is one device is an account one lost phone
   * away from a support ticket, and the recovery that would rescue it —
   * "forgot password" — updates credential rows in place: with no password
   * ever set it matched nothing and reported success, which is a reset that
   * silently does nothing.
   *
   * It can only ever FILL AN EMPTY SLOT. Where a password already exists this
   * refuses and `changePassword` is the way, which is what keeps it from
   * becoming a no-proof overwrite of somebody's credential: a stolen session
   * can already read everything, and the thing worth denying it is a
   * credential that outlives the session being revoked. Setting the first one
   * still hands it persistence, so the attempt is throttled, and every other
   * session is ended the moment it lands.
   */
  setPassword: protectedProcedure
    .input(z.object({ password: z.string().min(1) }))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx, input }) => {
      // The same rules the form ran, from the same module, so the two cannot
      // drift into accepting different passwords.
      const problem = passwordProblem(input.password);
      if (problem) {
        throw new ValidationError(problem, {
          meta: { fieldErrors: { password: [problem] } },
        });
      }

      // Email mode only. Under Auth0 the password lives in the Auth0 tenant
      // and this row is not where it would go.
      if ((await resolveAuthProvider()) !== "email") {
        throw new DirectRegistrationUnavailableError();
      }

      const limit = await rateLimit({
        key: `user.setPassword:${ctx.session.user.id}`,
        windowSeconds: 60 * 15,
        max: 5,
      });
      if (!limit.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      const credentialAccount = await ctx.prisma.account.findFirst({
        where: { userId: ctx.session.user.id, provider: "credential" },
        select: { id: true, password: true },
      });

      // The refusal that makes this safe to expose. Overwriting a password
      // without proving the old one is account takeover with extra steps.
      if (credentialAccount?.password) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This account already has a password. Change it instead of setting a new one.",
        });
      }

      const hashedPassword = await hash(input.password, 10);

      if (credentialAccount) {
        await ctx.prisma.account.update({
          where: { id: credentialAccount.id },
          data: { password: hashedPassword },
        });
      } else {
        // An account that predates the credential row being written up front
        // (an SSO-only user, say). The row is what password reset updates, so
        // it has to exist before recovery can work.
        await ctx.prisma.account.create({
          data: {
            userId: ctx.session.user.id,
            type: "credential",
            provider: "credential",
            // better-auth 1.7 finds a credential account by
            // `(providerId, issuer, accountId)` and nothing else. A row
            // written without the issuer is a row its lookup cannot see, so
            // the password set here would never sign anybody in — the
            // customer would be told their correct password is wrong.
            issuer: issuerForProviderId("credential"),
            providerAccountId: ctx.session.user.id,
            password: hashedPassword,
          },
        });
      }

      // Every other session ends. A password is a credential that outlives
      // session revocation, so anything else holding a session at the moment
      // one appears must not keep it. Skipped while impersonating for the
      // same reason `changePassword` skips it: the session id in hand is the
      // operator's, not the subject's.
      if (!ctx.session.user.impersonator && ctx.session.sessionId) {
        await revokeOtherSessionsForUser({
          prisma: ctx.prisma,
          userId: ctx.session.user.id,
          keepSessionId: ctx.session.sessionId,
        });
      }

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
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx, input }) => {
      // Resolved provider, not raw env (ADR-027): on a denied SSO deployment
      // the platform gate coerces to email mode, and a user who recovered via
      // the v6 password-reset path owns a `credential` account — they must be
      // able to change it (the coerced UI offers the button). `changePassword`
      // requires the current password, so this is not the takeover vector
      // Decision 4's all-states block guards against.
      const provider = await resolveAuthProvider();
      if (provider !== "email" && provider !== "auth0") {
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
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      if (provider === "auth0") {
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
    .noPermission({
      reason:
        "self-service for the named user; the handler enforces self-or-instance-admin itself",
    })
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      if (
        input.userId !== ctx.session.user.id &&
        !checkIsAdmin({ email: user.email })
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // UserService.deactivate also force-revokes all the user's sessions
      // (Redis cache + DB) — see iter-24 progress notes for why.
      await UserService.create(ctx.prisma).deactivate({ id: input.userId });
      return { success: true };
    }),
  reactivate: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .noPermission({
      reason:
        "self-service for the named user; the handler enforces self-or-instance-admin itself",
    })
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user.impersonator ?? ctx.session.user;
      if (!checkIsAdmin({ email: user.email })) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await UserService.create(ctx.prisma).reactivate({ id: input.userId });
      return { success: true };
    }),

  /**
   * Uploads and sets the caller's own avatar photo. The image is stored in the
   * S3-backed object store (owned by the user, under their personal workspace)
   * and its serve URL is written to `User.image`, the field every avatar
   * surface resolves through. `organizationId` scopes the personal-workspace
   * resolution and is membership-checked below.
   *
   * Spec: specs/settings/user-avatar.feature
   */
  setAvatar: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        // A base64 image data URL (`data:image/...;base64,...`) produced by the
        // client crop/resize step. Deliberately NOT bounded with a `.max()`
        // here: `parseAvatarDataUrl` rejects at exactly the same ceiling before
        // it scans or decodes anything, so a `.max()` only wins the race and
        // turns the specific `avatar_image_too_large` ("Pick one under 8 MB")
        // into the anonymous `validation_error`. The point of that code is that
        // both halves of the check answer with it, whichever caught the file.
        imageDataUrl: z.string().min(1),
      }),
    )
    .permission("organization:view")
    .mutation(async ({ ctx, input }) => {
      // Throttle uploads per user — each writes bytes to object storage and
      // updates the row; mirrors the changePassword budget shape.
      const limit = await rateLimit({
        key: `user.setAvatar:${ctx.session.user.id}`,
        windowSeconds: 60,
        max: 10,
      });
      if (!limit.allowed) {
        throw new AvatarRateLimitedError();
      }

      // `AvatarValidationError` is a handled error, so `handledErrorMiddleware`
      // carries its code and meta to the client on its own. Catching it here to
      // rewrap it as a BAD_REQUEST would only replace the code with the raw
      // message — the thing #5984 closed.
      return await new UserAvatarService(ctx.prisma).setAvatar({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        imageDataUrl: input.imageDataUrl,
        displayName: ctx.session.user.name,
        displayEmail: ctx.session.user.email,
      });
    }),

  /**
   * Clears the caller's uploaded avatar so surfaces fall back to their SSO
   * photo (if any) and then their initials.
   *
   * Spec: specs/settings/user-avatar.feature
   */
  removeAvatar: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx }) => {
      await new UserAvatarService(ctx.prisma).removeAvatar({
        userId: ctx.session.user.id,
      });
      return { success: true };
    }),

  /**
   * Personal context for a user inside an organization. Backs the /me
   * dashboard's `usePersonalContext` hook (see
   * src/components/me/usePersonalContext.ts for the consumed shape).
   *
   * Lazily provisions the personal workspace on first call so existing
   * users (who joined the org before this feature shipped) get one
   * without re-accepting an invite.
   *
   * Cost / activity rollups are intentionally NOT computed here this
   * iteration — the hook keeps its mocked data for those fields until
   * the ClickHouse aggregations land in iter 2. This procedure ships
   * the workspace identity + routing-policy resolution so the page
   * and CLI both have a stable contract to wire against.
   */
  personalContext: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Caller must be a member of the org.
      const membership = await ctx.prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId: input.organizationId,
          },
        },
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Not a member of organization ${input.organizationId}`,
        });
      }

      const workspaceService = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await workspaceService.ensure({
        userId,
        organizationId: input.organizationId,
        displayName: ctx.session.user.name,
        displayEmail: ctx.session.user.email,
      });

      const policyService = new RoutingPolicyService(ctx.prisma);
      const defaultPolicy = await policyService.resolveDefaultForUser({
        organizationId: input.organizationId,
        personalTeamId: workspace.team.id,
      });

      return {
        workspace,
        routingPolicy: defaultPolicy
          ? { id: defaultPolicy.id, name: defaultPolicy.name }
          : null,
      };
    }),

  /**
   * Per-user usage rollup powering the /me dashboard cards + charts +
   * recent activity. ClickHouse-backed, scoped to the user's personal
   * project (which by definition has only their traces — no cross-user
   * contamination possible).
   *
   * Returns empty-state safe values (zeros, empty arrays, null model)
   * when no traces exist yet, so the page can render before the user's
   * first CLI request lands in CH.
   */
  personalUsage: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        /** Defaults to start-of-current-month → now if omitted. */
        windowStartMs: z.number().optional(),
        windowEndMs: z.number().optional(),
      }),
    )
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const membership = await ctx.prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId: input.organizationId,
          },
        },
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Not a member of organization ${input.organizationId}`,
        });
      }

      // Find the user's personal project. If none yet, return empty-state.
      const workspaceService = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await workspaceService.findExisting({
        userId,
        organizationId: input.organizationId,
      });
      if (!workspace) {
        return {
          summary: {
            spentUsd: 0,
            billedUsd: 0,
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            mostUsedModel: null,
          },
          dailyBuckets: [],
          breakdownByModel: [],
        };
      }

      const window =
        input.windowStartMs && input.windowEndMs
          ? {
              start: new Date(input.windowStartMs),
              end: new Date(input.windowEndMs),
            }
          : undefined;

      const usage = PersonalUsageService.create(
        getApp().governance.personalUsage,
      );

      // Ingestion-source ledger rows (Claude Code OTLP, etc.) land under
      // the org's hidden Governance Project tenant. Resolve it read-only
      // so the PRINCIPAL-ledger union is scoped to this org's tenant.
      const governanceProject = await findHiddenGovernanceProject({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
      });

      // Run the rollup queries in parallel — they're independent and the
      // CH server happily multiplexes. userId + ingestionTenantId are
      // threaded so PersonalUsageService can union ingestion-source ledger
      // rows keyed on PRINCIPAL-scope budgets where ScopeId=userId, scoped
      // to this org's governance tenant. Without them, the /me dashboard
      // misses third-party traffic landing in the hidden governance
      // project tenant. Recent activity itself is read directly from the
      // personal project tenant by the /me table (tracesV2.list), so it
      // isn't fetched here.
      const ingestionTenantId = governanceProject?.id;
      const [summary, dailyBuckets, breakdownByModel] = await Promise.all([
        usage.summary({
          personalProjectId: workspace.project.id,
          window,
          userId,
          ingestionTenantId,
        }),
        usage.dailyBuckets({
          personalProjectId: workspace.project.id,
          window,
          userId,
          ingestionTenantId,
        }),
        usage.breakdownByModel({
          personalProjectId: workspace.project.id,
          window,
          userId,
          ingestionTenantId,
        }),
      ]);

      return {
        summary,
        dailyBuckets,
        breakdownByModel,
      };
    }),

  /**
   * Per-user budget state powering the /me dashboard's
   * BudgetExceededBanner. Same wire shape as the CLI 402 payload
   * (cli-reference.mdx "Budget pre-check") so client + CLI render
   * with identical fields.
   *
   * Delegates to GatewayBudgetService.check() with projectedCostUsd=0
   * — same code path the gateway uses at request time, so the UI's
   * banner state and the CLI's pre-check decision can never disagree.
   *
   * Returns:
   *   { status: "ok" }                                 nothing to render
   *   { status: "warning", ...details }                soft_warn (≥80% used)
   *   { status: "exceeded", ...details }               hard_block (≥100% used)
   *
   * Graceful-degradation cases that return {status: "ok"}:
   *   - User has no personal workspace yet
   *   - User has no personal VK yet
   *   - ClickHouse not configured (smaller self-hosters)
   */
  personalBudget: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const workspaceService = new PersonalWorkspaceService(ctx.prisma);
      const workspace = await workspaceService.findExisting({
        userId,
        organizationId: input.organizationId,
      });
      if (!workspace) return { status: "ok" as const };

      const vkService = PersonalVirtualKeyService.create(ctx.prisma);
      const vks = await vkService.list({
        userId,
        organizationId: input.organizationId,
      });
      const personalVk = vks[0];
      // OTLP-only users intentionally have no personal VK — they keep
      // their existing Anthropic OAuth seat and rely on Claude Code's
      // OTLP exporter (rchaves's headline "control my own personal
      // claude usage" persona). They still need budget visibility on
      // the principal scope. Use a sentinel virtualKeyId that won't
      // match any VK-scoped budget; principal-scope budgets resolve
      // via principalUserId regardless. Mirrors the pattern the
      // ingestion-source receiver uses on ledger writes
      // (`_ingestion_:<sourceId>`).
      const sentinelVk = `_ingestion_:user:${userId}`;

      const budgetService = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const decision = await budgetService.check({
        organizationId: input.organizationId,
        teamId: workspace.team.id,
        projectId: workspace.project.id,
        virtualKeyId: personalVk?.id ?? sentinelVk,
        principalUserId: userId,
        projectedCostUsd: 0,
      });

      // Status mapping: hard_block → exceeded (red banner),
      // soft_warn → warning (yellow banner), allow → ok (no banner).
      // The chip on /me however needs always-on snapshot data so it
      // can render "rogerio-claude-budget · 13% spent" even at 13%
      // (under the 80% banner threshold). Pick the best applicable
      // budget regardless of decision and pass through spent/limit
      // — the warning/exceeded banners still gate on `status` so
      // "ok" suppresses banners, only the chip data flows through.
      // Caught when MEMBER `rogerio@…` running OTLP-only Claude Code
      // had a real principal-scope budget at 13% but the chip read
      // "No budget set" — the early-return on allow threw away the
      // snapshot fields the chip needed.
      const sortedScopes = decision.scopes
        .map((s) => ({ ...s, pctUsed: percentUsed(s.spentUsd, s.limitUsd) }))
        .sort((a, b) => b.pctUsed - a.pctUsed);
      const topScope = decision.blockedBy[0] ?? sortedScopes[0];
      if (!topScope) return { status: "ok" as const };

      const baseStatus =
        decision.decision === "hard_block"
          ? ("exceeded" as const)
          : decision.decision === "soft_warn" ||
              ("pctUsed" in topScope && topScope.pctUsed >= 80)
            ? ("warning" as const)
            : ("ok" as const);

      // Display-facing contact: prefers admin-configured Organization.supportContact
      // (may be email, URL, or short instruction), falls back to the first admin email.
      // Distinct from the email-only resolver used below for actual email sending.
      const adminEmail = await resolveSupportContact({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
      });
      return {
        status: baseStatus,
        scope: normalizeScope(topScope.scope),
        spentUsd: topScope.spentUsd,
        limitUsd: topScope.limitUsd,
        period: topScope.window.toLowerCase(),
        requestIncreaseUrl: requestIncreaseUrl({
          baseUrl: env.NEXTAUTH_URL ?? env.BASE_HOST ?? null,
          scope: normalizeScope(topScope.scope),
          scopeId: topScope.scopeId,
          limitUsd: topScope.limitUsd,
          spentUsd: topScope.spentUsd,
        }),
        adminEmail,
      };
    }),

  /**
   * Every budget that binds the caller's own keys in this organization,
   * each labelled with its scope ("whole organization budget", "team
   * budget (Core)", "personal budget"), most binding first. One source:
   * the same BudgetOverviewService the CLI's
   * `GET /api/auth/cli/budget-overview` serves, so /me and the login
   * epilogue can never report different numbers for the same budget.
   *
   * `gatewayAccess: false` (governance flag off for the org, or caller
   * not a member) means the consumer renders nothing budget-related.
   *
   * Authorization: members read their OWN overview only - the userId is
   * always the session's. organization:view is the entry gate; the
   * service re-checks membership itself, fail closed.
   */
  budgetOverview: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        includeTopModels: z.boolean().optional(),
      }),
    )
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const service = BudgetOverviewService.create(
        ctx.prisma,
        getApp().gateway.budgets,
        getApp().governance.personalUsage,
      );
      return await service.overviewForUser({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        includeTopModels: input.includeTopModels,
      });
    }),

  /**
   * CLI bootstrap data for the Storyboard Screen 4 login-completion
   * ceremony. Returns inherited providers (with display name + model
   * list) + monthly budget (limit + used). Powers the
   * `formatLoginCeremony({ providers, budget })` rich-enrichment
   * variant in typescript-sdk.
   *
   * Wire shape — every field always populated:
   *   {
   *     providers: Array<{ name, displayName, models[] }>;
   *     budget: { monthlyLimitUsd: number | null, monthlyUsedUsd: number, period: string };
   *   }
   *
   * Empty-state safe: returns providers=[] + budget={null, 0, MONTHLY}
   * when the user has no personal workspace yet (fresh login,
   * no admin VK provisioning yet).
   *
   * Per @ai_gateway_andre b8b21bb79 (1.5a-cli-1 ceremony) +
   * Phase 1B.5 fold (5be9a5004).
   */
  cliBootstrap: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const service = CliBootstrapService.create({
        prisma: ctx.prisma,
        budgetRepository: getApp().gateway.budgets,
      });
      return await service.resolve({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
    }),

  /**
   * Submit a budget-increase request to the org admin. Triggered from the
   * `/me/budget/request` page (linked from the gateway's 402
   * `request_increase_url` and from the `langwatch request-increase`
   * CLI command). Resolves the org's first ADMIN by email and sends them
   * an HTML email with the user, scope, limit, spent, and optional
   * free-form message.
   */
  requestBudgetIncrease: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        scope: z.string(),
        scopeId: z.string(),
        limitUsd: z.string(),
        spentUsd: z.string(),
        period: z.string().optional(),
        message: z.string().max(2000).optional(),
      }),
    )
    .permission("organization:view")
    .mutation(async ({ ctx, input }) => {
      const adminEmail = await resolveOrgAdminEmail({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
      });
      if (!adminEmail) {
        logger.warn(
          { organizationId: input.organizationId },
          "budget increase requested but the organization has no admin",
        );
        throw new NoAdminConfiguredError();
      }
      const [organization, requester] = await Promise.all([
        ctx.prisma.organization.findUnique({
          where: { id: input.organizationId },
          select: { name: true },
        }),
        ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { email: true, name: true },
        }),
      ]);
      try {
        await sendBudgetIncreaseRequestEmail({
          to: adminEmail,
          requesterEmail: requester?.email ?? ctx.session.user.email ?? "",
          requesterName: requester?.name ?? undefined,
          organizationName: organization?.name ?? "",
          scope: input.scope,
          scopeId: input.scopeId,
          limitUsd: input.limitUsd,
          spentUsd: input.spentUsd,
          period: input.period,
          message: input.message,
        });
      } catch (err) {
        logger.error(
          { err, organizationId: input.organizationId },
          "failed to send budget increase request email",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "email_send_failed",
        });
      }
      return { ok: true as const, sentTo: adminEmail };
    }),

  /**
   * Persist (or clear) the user's pinned home destination. NULL clears
   * the pin and reverts to auto-detection. The picker UI (on
   * /me/configure) calls this when the user picks a destination from the
   * dropdown.
   *
   * Spec: specs/ai-gateway/governance/persona-home-content.feature
   *       (User pin > org pin > auto-detection priority)
   */
  setLastHomePath: protectedProcedure
    .input(
      z.object({
        path: z
          .string()
          .min(1)
          .max(1024)
          .regex(/^\//, "must start with /")
          .nullable(),
      }),
    )
    .noPermission({
      reason: "operates on the session user's own account, no tenant scope",
    })
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: { lastHomePath: input.path },
      });
      return { ok: true as const };
    }),

  /**
   * Snapshot of the user's home-page picker state for /me/configure:
   * the currently-pinned path (if any) + the auto-detected default
   * destination + the flags that drive which dropdown options to show.
   *
   * Powers the "Default landing page" picker. Single round-trip so the
   * UI doesn't have to compose multiple queries.
   */
  homePagePickerState: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:view")
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [user, firstProject] = await Promise.all([
        ctx.prisma.user.findUnique({
          where: { id: userId },
          select: { lastHomePath: true },
        }),
        ctx.prisma.project.findFirst({
          where: {
            team: {
              organizationId: input.organizationId,
              members: { some: { userId } },
            },
            archivedAt: null,
          },
          orderBy: { createdAt: "asc" },
          select: { slug: true },
        }),
      ]);
      return {
        lastHomePath: user?.lastHomePath ?? null,
        firstProjectSlug: firstProject?.slug ?? null,
        // The governance-home option is shown for any user who could
        // possibly land there via auto-detection — gate on the resolver's
        // own conjunctive check instead of duplicating the logic here.
        // The picker UI calls api.governance.resolveHome to learn the
        // auto-detected destination + isOverride flag and uses that to
        // decide which options to surface.
      };
    }),
});

// ---------------------------------------------------------------------------
// personalBudget helpers
// ---------------------------------------------------------------------------

function percentUsed(spentUsd: string, limitUsd: string): number {
  const limit = Number.parseFloat(limitUsd);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const spent = Number.parseFloat(spentUsd);
  return (spent / limit) * 100;
}

/** Map server-side scope codes to the wire-shape values the
 *  BudgetExceededBanner + CLI Screen-8 box accept. */
function normalizeScope(scope: string): string {
  const s = scope.toLowerCase();
  // VIRTUAL_KEY-scope blocks are surfaced as "personal" in the
  // user-facing banner — that matches the CLI's normalization.
  if (s === "virtual_key") return "personal";
  return s;
}

function requestIncreaseUrl(opts: {
  baseUrl: string | null;
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
}): string | undefined {
  if (!opts.baseUrl) return undefined;
  const params = new URLSearchParams({
    scope: opts.scope,
    scope_id: opts.scopeId,
    limit_usd: opts.limitUsd,
    spent_usd: opts.spentUsd,
  });
  return `${opts.baseUrl.replace(/\/$/, "")}/me/budget/request?${params.toString()}`;
}
