import { z } from "zod";
import { verificationCeremony } from "~/server/app-layer/identity/runtime";
import { createTRPCRouter, protectedProcedure } from "../trpc";

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
});
