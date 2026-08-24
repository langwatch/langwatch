import { auditLog } from "~/runtime/app/features/audit-log";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { InvalidUnsubscribeTokenError } from "@langwatch/automation-contract";
import { getClientIp } from "~/utils/getClientIp";
import { rateLimit } from "../../rateLimit";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

/**
 * ADR-031: the unsubscribe procedures are public (the token is the only
 * authorization), so they are an unauthenticated surface an attacker can
 * hammer to brute-force tokens or exhaust the mail/DB path. Keyed by client
 * IP — falls back to a shared bucket when the IP is unknown so a missing
 * header still throttles rather than bypasses.
 */
async function enforceUnsubscribeRateLimit({
  ip,
  action,
  max,
}: {
  ip: string | undefined;
  action: string;
  max: number;
}): Promise<void> {
  const limit = await rateLimit({
    key: `unsubscribe:${action}:${ip ?? "unknown"}`,
    windowSeconds: 60,
    max,
  });
  if (!limit.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again shortly.",
    });
  }
}

export const emailSuppressionRouter = createTRPCRouter({
  /**
   * ADR-031: public token resolution for the `/unsubscribe` page. The token is
   * the authorization — its HMAC binds it to one recipient — so no login is
   * required. Returns masked email + project/trigger names, or NOT_FOUND on an
   * invalid/tampered token or a project that no longer exists.
   */
  resolveUnsubscribeToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .noPermission({
      reason:
        "unsubscribe flows are gated by the single-purpose token in the link, not by a role",
    })
    .query(async ({ input, ctx }) => {
      await enforceUnsubscribeRateLimit({
        ip: getClientIp(ctx.req),
        action: "resolve",
        max: 30,
      });
      const view = await ctx.app.automation.tryResolveUnsubscribeView({
        token: input.token,
      });
      if (!view) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This unsubscribe link is invalid or has expired.",
        });
      }
      return view;
    }),

  /** Public one-click / button confirm. Idempotent — the suppression upsert
   *  collapses duplicates. */
  confirmUnsubscribe: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        scope: z.enum(["trigger", "project"]),
      }),
    )
    .noPermission({
      reason:
        "unsubscribe flows are gated by the single-purpose token in the link, not by a role",
    })
    .mutation(async ({ input, ctx }) => {
      await enforceUnsubscribeRateLimit({
        ip: getClientIp(ctx.req),
        action: "confirm",
        max: 10,
      });
      try {
        await ctx.app.automation.confirmUnsubscribe({
          token: input.token,
          scope: input.scope,
        });
      } catch (err) {
        // A bad/tampered token is the recipient's problem (4xx); a downstream
        // persistence failure is ours (5xx) and must not masquerade as an
        // "invalid link".
        if (err instanceof InvalidUnsubscribeTokenError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This unsubscribe link is invalid.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not process unsubscribe. Please try again.",
        });
      }
      return { ok: true };
    }),

  /** Operator-facing suppression list (ADR-031). Each row is enriched with its
   *  trigger name (null triggerId = project-wide) so the table can render the
   *  scope without a second round-trip. */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("triggers:view")
    .query(async ({ input, ctx }) => {
      const rows = await ctx.app.automation.getAllEnriched({
        projectId: input.projectId,
      });
      void auditLog({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        action: "emailSuppression.getAll",
        args: {
          recordCount: rows.length,
          triggerIds: [
            ...new Set(
              rows
                .map((r) => r.triggerId)
                .filter((id): id is string => id != null),
            ),
          ],
        },
      });
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        triggerId: r.triggerId,
        triggerName: r.triggerName,
        reason: r.reason,
        createdAt: r.createdAt,
      }));
    }),

  /** Removing a suppression resumes delivery — a deliberate operator action. */
  remove: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("triggers:manage")
    .mutation(async ({ input, ctx }) => {
      await ctx.app.automation.removeSuppression({
        projectId: input.projectId,
        id: input.id,
      });
      void auditLog({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        action: "emailSuppression.remove",
        args: { suppressionId: input.id },
      });
      return { ok: true };
    }),
});
