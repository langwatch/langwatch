import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  signInRouter,
  signUpVerification,
} from "~/server/app-layer/identity/runtime";
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
import { createTRPCRouter, publicProcedure } from "../trpc";

/**
 * The unauthenticated front door (D13, ADR-117 §6).
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
export const frontDoorRouter = createTRPCRouter({
  /**
   * Where this address signs in. The decision object IS the contract: the
   * screen renders `methodSet` and keys its guidance off `reasonCode`.
   *
   * A mutation rather than a query on purpose: a query would be cached and
   * refetched per address, and a per-address cache entry is an
   * account-existence oracle built out of network timing. The router itself
   * cannot tell a registered address from an unregistered one (ADR-117 §2) —
   * this keeps the transport from learning it either.
   */
  route: publicProcedure
    .input(
      z.object({
        /** Null before any address has been typed. */
        identifier: z.string().nullable(),
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
      const limit = await rateLimit({
        key: `frontDoor.route:${ip}`,
        windowSeconds: 60 * 60,
        max: 200,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many sign-in attempts. Please try again later.",
        });
      }

      return signInRouter().route({
        identifier: input.identifier,
        breakGlass: input.breakGlass ?? false,
      });
    }),

  /**
   * Sends a sign-up address its confirmation link. Sign-up is
   * verification-first (ADR-117 §6), so this runs before a method is chosen
   * and before anything at all exists for the address.
   *
   * An address that already has an account is told so (epic Q12): the
   * no-oracle invariant is scoped to sign-in and reset, and refusing to say
   * it here is what strands somebody on an account they half-created.
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
        key: `frontDoor.requestSignUpVerification:${ip}`,
        windowSeconds: 60 * 60,
        max: 20,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many signup attempts. Please try again later.",
        });
      }

      const verification = signUpVerification();
      if (await verification.addressIsRegistered({ email: input.email })) {
        throw new EmailAlreadyRegisteredError();
      }

      await verification.requestVerification({ email: input.email });
      return { sent: true as const };
    }),

  /**
   * A password typed into the log-in form for an address nobody holds.
   *
   * That is not a failed log-in, it is a sign-up that came in the other door,
   * and answering it as a refusal is the dead end this front door exists to
   * remove. So it is answered the way sign-up is: the credential is held as a
   * hash, a confirmation link goes out, and the account exists once the link
   * comes back.
   *
   * An address that DOES have an account is answered `account_exists`, and the
   * screen says the address and password do not match — the honest failure,
   * with no more detail than a wrong password has ever had.
   */
  startPasswordSignUp: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
    )
    .noPermission({
      reason:
        "starts a signed-out visitor's own sign-up from the log-in form; no tenant scope exists before an account does",
    })
    .mutation(async ({ ctx, input }) => {
      const ip = getClientIp(ctx.req) ?? "unknown";
      const limit = await rateLimit({
        key: `frontDoor.startPasswordSignUp:${ip}`,
        windowSeconds: 60 * 60,
        max: 20,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many signup attempts. Please try again later.",
        });
      }

      return signUpVerification().startPasswordSignUp({
        email: input.email,
        password: input.password,
      });
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
        key: `frontDoor.completeSignUpVerification:${ip}`,
        windowSeconds: 60 * 60,
        max: 60,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please try again later.",
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
        key: `frontDoor.inviteLanding:${ip}`,
        windowSeconds: 60 * 60,
        max: 60,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please try again later.",
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
        key: `frontDoor.requestFreshInvite:${ip}`,
        windowSeconds: 60 * 60,
        max: 20,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please try again later.",
        });
      }

      await InviteService.create(ctx.prisma).requestFreshInvite({
        inviteCode: input.inviteCode,
        membersSettingsUrl: buildMembersSettingsUrl(),
      });

      return { asked: true };
    }),
});
