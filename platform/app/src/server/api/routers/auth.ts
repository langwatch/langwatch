import { z } from "zod";
import {
  signInRouter,
  signUpVerification,
} from "~/server/app-layer/identity/runtime";
import {
  AuthRateLimitedError,
  NoAddressToConfirmError,
} from "~/server/auth/errors";
import {
  InviteExpiredError,
  InviteNotFoundError,
} from "~/server/invites/errors";
import {
  InviteService,
  resolveInviteDisplayStatus,
} from "~/server/invites/invite.service";
import { buildMembersSettingsUrl } from "~/server/invites/invite-link";
import { rateLimit } from "~/server/rateLimit";
import { EmailAlreadyRegisteredError } from "~/server/users/errors";
import { getClientIp } from "~/utils/getClientIp";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

/**
 * The unauthenticated auth screens (D13, ADR-117 §6).
 *
 * Everything a signed-out person's screens ask the server, in one place:
 * where an address should sign in, whether a sign-up address is confirmed,
 * and who is asking them to join. All of it is public by definition — the
 * caller has no session yet, which is the whole point of the surface — so
 * every procedure here is rate-limited and every answer is written to be
 * safe in front of whoever arrived, not whoever it was meant for.
 *
 * The screens hold no routing logic: they render what `route` decides
 * (ADR-117 §6). A screen state that needs a new behavior needs a new reason
 * code on the router first, not a branch here.
 */
/**
 * How long until the budget refills, in whole seconds, never negative.
 *
 * Carried on the refusal so the screen can count down rather than say "later"
 * and leave somebody guessing whether to wait a minute or an hour. A clock
 * that has already passed answers zero, which the copy reads as "no idea" and
 * falls back to its vaguer sentence.
 */
function secondsUntil(resetAt: number): number {
  return Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
}

export const authRouter = createTRPCRouter({
  /**
   * Where this address signs in. The decision object IS the contract: the
   * screen renders `methodSet` and keys its guidance off `reasonCode`.
   *
   * A mutation rather than a query, still, though the reason has changed. It
   * was to keep a per-address cache entry from becoming an existence oracle
   * built out of network timing; since the 2026-08-25 revision of ADR-117 the
   * decision says so outright, so what the mutation buys now is that the
   * answer is never served from a cache at all — an account that gains a
   * passkey is offered one on the next attempt rather than after a reload.
   *
   * The budget below is what still protects the user base. Any single answer
   * is cheap now; a MILLION of them must not be, and that is the property
   * rate limiting defends rather than secrecy.
   */
  route: publicProcedure
    .input(
      z.object({
        /**
         * Null before any address has been typed. Bounded because this is a
         * public endpoint: 254 is the RFC 5321 ceiling for an address, and
         * anything past it is not one — no need to carry it into
         * normalization or the routing recorder.
         */
        identifier: z.string().max(254).nullable(),
        /** `?local=1`: the local method set, whatever else would route. */
        breakGlass: z.boolean().optional(),
      }),
    )
    .noPermission({
      reason:
        "answers where a signed-out visitor should sign in; org-level routing only, and the engine reads no user data at all",
    })
    .mutation(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req) ?? "unknown";
      // 200 an hour was a generous budget for a routing question nobody could
      // learn anything from. This one answers whether an address has an
      // account, so the budget is sized for a PERSON signing in — a handful of
      // attempts, a mistyped address, a colleague on the same office address —
      // rather than for a script walking a list. Sixty an hour is still more
      // than anybody signing in has ever needed, and it turns enumerating a
      // user base into a job measured in months per address block.
      const limit = await rateLimit({
        key: `auth.route:${ip}`,
        windowSeconds: 60 * 60,
        max: 60,
      });
      if (!limit.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      return signInRouter().route({
        identifier: input.identifier,
        breakGlass: input.breakGlass ?? false,
      });
    }),

  /**
   * Sends a sign-up address its confirmation link again.
   *
   * Sign-up itself no longer calls this: the link goes out from the call that
   * CREATES the account (`user.register`, and the passkey hook), because that
   * is the one place where the address being mailed is provably the one just
   * registered. What is left for this endpoint is the case that call cannot
   * cover — the link expired, or never arrived, and the person is standing on
   * the dead-link screen with no session to ask from, because sign-up opens
   * none until the address is confirmed (ADR-117 §6).
   *
   * So it will mail an address that has an account only while that account is
   * still AWAITING confirmation. That is the narrowest opening that answers
   * the case: it cannot mail a confirmed account at all, and the mail it does
   * send is a duplicate of one already sent to the same address.
   *
   * A CONFIRMED address is told it is registered (epic Q12): the no-oracle
   * invariant is scoped to sign-in and reset, and refusing to say it here is
   * what strands somebody on an account they half-created.
   */
  requestSignUpVerification: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .noPermission({
      reason:
        "starts a signed-out visitor's own sign-up; no tenant scope exists before an account does",
    })
    .mutation(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req) ?? "unknown";
      const limit = await rateLimit({
        key: `auth.requestSignUpVerification:${ip}`,
        windowSeconds: 60 * 60,
        max: 20,
      });
      if (!limit.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      const verification = signUpVerification();
      if (
        (await verification.addressState({ email: input.email })) ===
        "confirmed"
      ) {
        throw new EmailAlreadyRegisteredError();
      }

      // A second budget, per ADDRESS rather than per caller. The one above
      // stops a script; this one stops any number of callers turning a
      // stranger's half-finished sign-up into a way to mail them repeatedly,
      // which is the cost of letting a registered-but-unconfirmed address
      // through at all.
      const perAddress = await rateLimit({
        key: `auth.requestSignUpVerification:address:${input.email.toLowerCase()}`,
        windowSeconds: 60 * 60,
        max: 5,
      });
      if (!perAddress.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(perAddress.resetAt),
        });
      }

      await verification.requestVerification({ email: input.email });
      return { sent: true as const };
    }),

  /**
   * Whether the caller's own address has been confirmed, and which address it
   * is.
   *
   * The read behind the app's "we have not confirmed this yet" nudge (D13).
   * The caller's own session is the only thing it answers about, so there is
   * no address anybody can ask this about but their own — and the answer says
   * nothing about anybody else's account.
   */
  myAddressConfirmation: protectedProcedure
    .noPermission({
      reason:
        "reads the session user's own address confirmation state; no tenant scope is involved and no other account is reachable",
    })
    .query(async ({ ctx }) => {
      const row = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { email: true, emailVerified: true },
      });
      return {
        email: row?.email ?? null,
        confirmed: Boolean(row?.emailVerified),
      };
    }),

  /**
   * Sends the confirmation link for the CALLER'S OWN address.
   *
   * Signing up creates the account and signs the person in; confirming the
   * address follows them in rather than standing in front of them (ADR-117 §6,
   * revised). This is what sends it, and what the app's "we have not confirmed
   * this yet" nudge will resend from.
   *
   * Protected, unlike everything else on this router, and that is the design
   * rather than an inconsistency. A public "send a confirmation to this
   * address" is a mailer pointed at any address anybody types, and the guard
   * that keeps `requestSignUpVerification` honest — refusing an address that
   * already has an account — is exactly the guard this one cannot have, since
   * by now the account is the whole point. Taking the address from the session
   * instead of the request closes it completely: the only address anybody can
   * send to is the one they are already signed in as.
   */
  sendMyAddressConfirmation: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason:
        "sends the session user's own address confirmation; no tenant scope is involved",
    })
    .mutation(async ({ ctx }) => {
      const email = ctx.session.user.email;
      if (!email) {
        throw new NoAddressToConfirmError();
      }

      const limit = await rateLimit({
        key: `auth.sendMyAddressConfirmation:${ctx.session.user.id}`,
        windowSeconds: 60 * 60,
        max: 10,
      });
      if (!limit.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      await signUpVerification().requestVerification({ email });
      return { sent: true as const };
    }),

  /**
   * Spends a confirmation link and answers the address it confirmed, so the
   * screen can carry on to the method choice. A link that carried a pending
   * credential also creates the account. Expired, already spent and never
   * issued are one refusal — the way on is the same for all three.
   */
  completeSignUpVerification: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .noPermission({
      reason:
        "spends a signed-out visitor's own emailed confirmation token; the token is the authorization",
    })
    .mutation(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req) ?? "unknown";
      const limit = await rateLimit({
        key: `auth.completeSignUpVerification:${ip}`,
        windowSeconds: 60 * 60,
        max: 60,
      });
      if (!limit.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      return signUpVerification().completeVerification({ token: input.token });
    }),

  /**
   * What an invitation link can say to whoever opens it: which organization
   * is asking, and who asked. Enough to decide whether to accept, and
   * nothing that would make a guessed code worth guessing — no address, no
   * role, no membership.
   *
   * A revoked invitation reads exactly like a missing one, the same way
   * `organization.acceptInvite` answers it: the journey ends quietly.
   * Expired is different, because it is recoverable in one click by the
   * inviter (D11).
   */
  inviteLanding: publicProcedure
    .input(z.object({ inviteCode: z.string().min(1) }))
    .noPermission({
      reason:
        "reads the invitation the caller holds the code for; the code is the authorization, and the answer names no person and no address",
    })
    .query(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req) ?? "unknown";
      const limit = await rateLimit({
        key: `auth.inviteLanding:${ip}`,
        windowSeconds: 60 * 60,
        max: 60,
      });
      if (!limit.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      const invite = await ctx.prisma.organizationInvite.findUnique({
        where: { inviteCode: input.inviteCode },
        select: {
          status: true,
          expiration: true,
          organization: { select: { name: true } },
          requestedByUser: { select: { name: true } },
        },
      });

      if (!invite || invite.status === "REVOKED") {
        throw new InviteNotFoundError("Invitation not found");
      }

      const status = resolveInviteDisplayStatus(invite);
      if (status === "EXPIRED") {
        throw new InviteExpiredError();
      }

      return {
        organizationName: invite.organization.name,
        inviterName: invite.requestedByUser?.name ?? null,
        alreadyAccepted: status === "ACCEPTED",
      };
    }),

  /**
   * "My invitation expired, send me another" (D11).
   *
   * The person asking is holding a stale code and may have no session at
   * all, so this mints nothing: it tells the organization's admins that
   * somebody is waiting, and they resend from the members table. Letting a
   * stale code refresh itself would make the expiry decorative.
   *
   * Two limits, because they stop different things. The per-IP one stops a
   * script walking codes; the per-invitation one stops any number of people
   * turning one invitation into a way to mail somebody repeatedly, and it
   * is the SAME counter the admin's resend spends, so the two routes to one
   * inbox cannot be used to double up.
   *
   * The answer is the same shape whatever happened, and never says how many
   * admins exist or who they are.
   */
  requestFreshInvite: publicProcedure
    .input(z.object({ inviteCode: z.string().min(1) }))
    .noPermission({
      reason:
        "asks the holder of an expired code's organization to send a new one; mints nothing, names nobody, and is throttled per code and per IP",
    })
    .mutation(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req) ?? "unknown";
      const limit = await rateLimit({
        key: `auth.requestFreshInvite:${ip}`,
        windowSeconds: 60 * 60,
        max: 20,
      });
      if (!limit.allowed) {
        throw new AuthRateLimitedError({
          retryAfterSeconds: secondsUntil(limit.resetAt),
        });
      }

      await InviteService.create(ctx.prisma).requestFreshInvite({
        inviteCode: input.inviteCode,
        membersSettingsUrl: buildMembersSettingsUrl(),
      });

      return { asked: true };
    }),
});
