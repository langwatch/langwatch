import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  accountIdentifiers,
  verificationCeremony,
} from "~/server/app-layer/identity/runtime";
import { rateLimit } from "~/server/rateLimit";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * RFC 7636 §4.2: the S256 challenge, base64url of a SHA-256 digest — 43
 * characters from the unreserved set. Checked here rather than trusted,
 * because an unbounded string would be stored and compared as one.
 */
const codeChallengeSchema = z.string().regex(/^[A-Za-z0-9._~-]{43}$/);

/**
 * The identity surface the app itself calls (D01).
 *
 * tRPC, not a versioned REST family: every operation here acts on the
 * CALLER'S OWN identity, so the credential is the session and the caller is
 * always this app's own frontend. That is the lane the rest of the product
 * uses. The public, versioned, API-key surface is for things outside the
 * app — when SCIM arrives (D08) it brings its own token auth and its own
 * family, and it will not reuse a session.
 *
 * No permission check applies and none is missing: identity is user-scoped,
 * not organization-scoped. `protectedProcedure` proves the session, and the
 * ceremony service proves the verification record is pinned to exactly that
 * user — so a caller can only ever act on themselves.
 *
 * Spec: specs/identity/identifier-model.feature.
 */
export const identityRouter = createTRPCRouter({
  /**
   * Complete an email verification ceremony. Carries the two proofs that
   * must arrive together: the emailed single-use token, and the PKCE
   * verifier held by the context that STARTED the ceremony. A link opened
   * on its own — forwarded, or followed by a mail scanner — can never
   * verify anything, because it carries only the first.
   */
  completeVerification: protectedProcedure
    .input(
      z.object({
        identifierId: z.string().min(1),
        verificationId: z.string().min(1),
        token: z.string().min(1),
        // RFC 7636 §4.1: 43-128 characters from the unreserved set.
        codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
      }),
    )
    // ADR-092's contract: every procedure states its permission or why it
    // has none. This one acts on the caller's OWN verification record -
    // there is no organization scope to check. The session proves who they
    // are, and the ceremony service proves the record is pinned to exactly
    // that user, so the input carries no scope a caller could widen.
    .noPermission({
      reason:
        "completes the session user's own email verification; the ceremony service proves the record is pinned to that user, and no organization scope applies",
    })
    .mutation(async ({ ctx, input }) => {
      await verificationCeremony().completeEmailVerification({
        userId: ctx.session.user.id,
        identifierId: input.identifierId,
        verificationId: input.verificationId,
        token: input.token,
        codeVerifier: input.codeVerifier,
      });
      return { verified: true as const };
    }),

  /**
   * Every way in the caller's own account holds, and what the detach guard
   * would say about giving each one up.
   *
   * The refusal comes down WITH the list so the screen can stand its Remove
   * control down before anybody clicks, in the guard's own words. It is a
   * prediction, not the decision: `removeIdentifier` still asks the guard.
   */
  myIdentifiers: protectedProcedure
    // An empty object rather than no input at all, like every sibling here.
    // A procedure with no declared input reaches the authz middleware as
    // `undefined`, and reading a field off it threw — the middleware no longer
    // does, and this no longer asks it to.
    .input(z.object({}))
    .noPermission({
      reason:
        "lists the session user's own sign-in identifiers; no organization scope applies and no other account is reachable",
    })
    .query(({ ctx }) =>
      accountIdentifiers().listIdentifiers({ userId: ctx.session.user.id }),
    ),

  /**
   * When each of the caller's sign-in methods last got them in.
   *
   * Read from SESSIONS rather than from the credentials themselves, because a
   * credential knows when it was made and nothing else. `Session.identifierId`
   * records which method minted the session (D06) and `Session.amr` records
   * what that sign-in proved, so the newest session naming a method is the
   * last time that method worked.
   *
   * What this is FOR is the question "can I delete this?". A passkey nobody
   * has used since they set it up is a passkey somebody will hesitate over
   * forever; one they used this morning is obviously load-bearing. Neither is
   * answerable from a list of names and dates of creation.
   *
   * Sessions expire and are deleted, so "never" here means "not in any
   * session we still hold" rather than "never used" — which is why the client
   * says nothing at all rather than "never used" for a method with no answer.
   * Claiming a passkey was never used, when the evidence merely aged out,
   * would talk somebody into deleting the credential they rely on.
   */
  myMethodsLastUsed: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason:
        "reads when the session user's own sign-in methods last minted a session; no organization scope applies and no other account is reachable",
    })
    .query(async ({ ctx }) => {
      const sessions = await ctx.prisma.session.findMany({
        where: { userId: ctx.session.user.id },
        select: { identifierId: true, amr: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });

      // First write wins, which is why the rows arrive newest-first: the
      // first session naming a method IS that method's last use.
      const byIdentifier: Record<string, string> = {};
      let secondFactorAt: string | null = null;
      for (const session of sessions) {
        if (session.identifierId && !byIdentifier[session.identifierId]) {
          byIdentifier[session.identifierId] = session.createdAt.toISOString();
        }
        // RFC 8176 references. `mfa` covers the multi-factor claim itself and
        // `otp` the authenticator code, because a sign-in may record either
        // depending on which leg satisfied the requirement.
        if (
          secondFactorAt === null &&
          session.amr.some((method) => method === "mfa" || method === "otp")
        ) {
          secondFactorAt = session.createdAt.toISOString();
        }
      }

      return { byIdentifier, secondFactorAt };
    }),

  /**
   * Add another email address to the caller's own account.
   *
   * The address arrives UNVERIFIED and a confirmation link goes to it. Rate
   * limited per caller because it sends mail to an address nobody has proved
   * — the abuse shape is somebody using an account as a way to mail a
   * stranger, and the limit is what makes that not worth doing.
   */
  addEmailIdentifier: protectedProcedure
    .input(
      z.object({
        email: z.string().email().max(254),
        codeChallenge: codeChallengeSchema,
      }),
    )
    .noPermission({
      reason:
        "adds an identifier to the session user's own account; no organization scope applies",
    })
    .mutation(async ({ ctx, input }) => {
      const limit = await rateLimit({
        key: `identity.addEmailIdentifier:${ctx.session.user.id}`,
        windowSeconds: 60 * 60,
        max: 10,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please try again later.",
        });
      }

      return accountIdentifiers().addEmailIdentifier({
        userId: ctx.session.user.id,
        email: input.email,
        codeChallenge: input.codeChallenge,
      });
    }),

  /**
   * Send the confirmation link again for one of the caller's own unconfirmed
   * addresses. A fresh ceremony, so the newest link is the only one that
   * works and the browser asking now is the one that can finish it.
   */
  resendIdentifierConfirmation: protectedProcedure
    .input(
      z.object({
        identifierId: z.string().min(1),
        codeChallenge: codeChallengeSchema,
      }),
    )
    .noPermission({
      reason:
        "re-sends the session user's own address confirmation; the ceremony proves the identifier is theirs",
    })
    .mutation(async ({ ctx, input }) => {
      const limit = await rateLimit({
        key: `identity.resendIdentifierConfirmation:${ctx.session.user.id}`,
        windowSeconds: 60 * 60,
        max: 10,
      });
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Please try again later.",
        });
      }

      await accountIdentifiers().resendConfirmation({
        userId: ctx.session.user.id,
        identifierId: input.identifierId,
        codeChallenge: input.codeChallenge,
      });
      return { sent: true as const };
    }),

  /**
   * Give up one of the caller's own ways in.
   *
   * The guard decides, here and not on the screen: whatever the list said,
   * this refuses a removal that would leave nobody able to get back in, with
   * the code the client's registry has words for. A primary identifier
   * demotes first, which is the state machine's rule rather than this
   * surface's.
   */
  removeIdentifier: protectedProcedure
    .input(z.object({ identifierId: z.string().min(1) }))
    .noPermission({
      reason:
        "removes an identifier from the session user's own account; the identity guards decide, and no organization scope applies",
    })
    .mutation(async ({ ctx, input }) => {
      await accountIdentifiers().removeIdentifier({
        userId: ctx.session.user.id,
        identifierId: input.identifierId,
      });
      return { removed: true as const };
    }),
});
