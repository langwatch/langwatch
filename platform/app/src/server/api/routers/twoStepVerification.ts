import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { organizationMfa } from "~/server/app-layer/identity/runtime";
import { twoStepVerification } from "~/server/app-layer/identity/two-step-runtime";

/**
 * Two-step verification (D06): a person's own setup, and an organization's
 * requirement that its members hold one.
 *
 * The split of permissions here is the whole model in miniature. The account
 * procedures take no permission because there is no scope to hold one on —
 * the caller is asking about themselves, and the handler answers for the
 * session's own user id and nothing else. The organization procedures take
 * `organization:manage`, the same authority that invites and removes members,
 * because requiring a second factor is a decision about who may be one.
 *
 * `standing` sits between the two and is deliberately unpermissioned: it is
 * the question "may I reach this organization's data", asked by somebody who
 * may be held at a gate, and answering it needs no authority beyond being
 * asked by the person themselves. It reveals nothing — a non-member gets the
 * same shape a member with nothing set up does.
 */
export const twoStepVerificationRouter = createTRPCRouter({
  /** The caller's own setup, for their security screen. */
  account: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason:
        "the caller's own two-step verification, answered for the session's user id alone",
    })
    .query(async ({ ctx }) => {
      return twoStepVerification().standingFor({ userId: ctx.session.user.id });
    }),

  /**
   * Turn it off, with the password and a current code.
   *
   * Not better-auth's `/two-factor/disable` on its own, because better-auth
   * does not know our organizations exist: the refusal for a person whose
   * organization requires one belongs in front of the plugin's disable, where
   * it is enforced rather than merely offered by the screen.
   */
  disable: protectedProcedure
    .input(
      z.object({
        // Absent for an account that holds none. The plugin waives the
        // re-proof for exactly those accounts (`allowPasswordless`), and a
        // current authenticator code is still demanded either way.
        password: z.string().min(1).optional(),
        code: z.string().min(1),
      }),
    )
    .noPermission({
      reason:
        "the caller turning off their own two-step verification, matched on the session's user id; the password and a current code are the proof",
    })
    .mutation(async ({ ctx, input }) => {
      return twoStepVerification().disable({
        userId: ctx.session.user.id,
        password: input.password,
        code: input.code,
        headers: requestHeaders(ctx.req?.headers),
      });
    }),

  /** Where the caller stands with one organization, on this session. */
  standing: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .noPermission({
      reason:
        "the caller asking whether an organization's second-factor requirement holds them; answered for the session's own user id, and the same shape for a member and a stranger",
      allow: {
        organizationId: "the organization the caller is trying to reach",
      },
    })
    .query(async ({ ctx, input }) => {
      return organizationMfa().standingForSession({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        sessionId: ctx.session.sessionId,
      });
    }),

  /** What this organization has set, and what its connection asserts. */
  requirement: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .permission("organization:manage")
    .query(async ({ input }) => {
      return organizationMfa().readRequirement({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Turn the requirement on or off.
   *
   * Audited by the mutation middleware, which stamps the acting user, the
   * organization and the arguments — the same record an invitation or a
   * removal leaves. Nothing here ends a session, in either direction.
   */
  setRequirement: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        mfaRequired: z.boolean(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      return organizationMfa().setRequirement({
        organizationId: input.organizationId,
        mfaRequired: input.mfaRequired,
        actorUserId: ctx.session.user.id,
      });
    }),

  /** Who can prove a second factor and who cannot, for the member list. */
  memberFactors: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .permission("organization:manage")
    .query(async ({ input }) => {
      return organizationMfa().memberFactors({
        organizationId: input.organizationId,
      });
    }),
});

/** The request's headers, in the shape better-auth's server API takes. */
function requestHeaders(
  input: IncomingHttpHeaders | Headers | undefined,
): Headers {
  if (!input) return new Headers();
  if (input instanceof Headers) return input;
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    appendHeader({ headers, name, value });
  }
  return headers;
}

/** One header, which node may hand us absent, once, or repeated. */
function appendHeader({
  headers,
  name,
  value,
}: {
  headers: Headers;
  name: string;
  value: string | string[] | undefined;
}): void {
  if (value == null) return;
  if (!Array.isArray(value)) {
    headers.set(name, String(value));
    return;
  }
  for (const one of value) headers.append(name, one);
}
