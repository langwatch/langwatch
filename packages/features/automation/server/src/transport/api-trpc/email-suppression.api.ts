/**
 * The email-suppression surface over the process's tRPC transport (ADR-031).
 *
 * Two audiences on one router. The unsubscribe pair is PUBLIC — the link
 * arrives in a mail client where no session exists, and the single-purpose
 * token in it, whose HMAC binds it to one recipient, is the whole
 * authorization. Both are therefore an unauthenticated surface an attacker can
 * hammer to brute-force tokens or exhaust the mail and database path, so both
 * are throttled per client IP, falling back to a shared bucket when the IP is
 * unknown: a missing header must still throttle rather than bypass.
 *
 * The operator pair is authenticated and gated on the automation permissions,
 * and both are audited explicitly rather than by the mutation audit middleware
 * — `getAll` is a query, and reading a suppression list means reading customer
 * email addresses.
 *
 * Transport only: gates, throttles and delegation to `AutomationService`.
 */
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import { InvalidUnsubscribeTokenError } from "@langwatch/automation-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import {
  UnsubscribeLinkInvalidError,
  UnsubscribeRateLimitedError,
  type AutomationApp,
} from "#app/automation.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * The same slice the authoring surface takes, and the same {@link AutomationApp}
 * object: two doors onto one feature reach one application, which is what stops
 * a suppression rule from meaning one thing here and another there.
 */
export type EmailSuppressionTrpcContext = Readonly<{
  app: Readonly<{ automation: AutomationApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type EmailSuppressionTrpcProcedures<
  TContext extends EmailSuppressionTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's unauthenticated procedure — the unsubscribe link's whole point. */
  public: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/** The process capabilities this transport needs; none of them are automation's. */
export type EmailSuppressionTrpcPorts = Readonly<{
  /** The caller's IP. `undefined` where the transport cannot see one. */
  clientIp(ctx: EmailSuppressionTrpcContext): string | undefined;
  /** The shared counter. Returns whether this attempt is inside the budget. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean }>>;
  /** Writes one audit row. Fire and forget: an audit failure never fails a read. */
  recordAudit(
    entry: Readonly<{
      userId: string;
      projectId?: string;
      action: string;
      args?: unknown;
      targetKind?: string;
      targetId?: string;
    }>,
  ): Promise<void>;
}>;

const UNSUBSCRIBE_TOKEN_IS_THE_AUTHORIZATION: AuthzDeclaration = {
  kind: "no-permission",
  reason: "unsubscribe flows are gated by the single-purpose token in the link, not by a role",
};

const resolveInputSchema = z.object({ token: z.string().min(1) });

const confirmInputSchema = z.object({
  token: z.string().min(1),
  scope: z.enum(["trigger", "project"]),
});

const projectScopeSchema = z.object({ projectId: z.string() });

const removeInputSchema = z.object({ projectId: z.string(), id: z.string() });

/** Installs the complete `emailSuppression.*` tRPC surface on a process-owned root. */
export class EmailSuppressionTrpcApi {
  static create<
    TContext extends EmailSuppressionTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: EmailSuppressionTrpcProcedures<TContext, TOptions, TRoot>,
    ports: EmailSuppressionTrpcPorts,
  ) {
    const { protected: procedure, public: publicProcedure, policy } = procedures;

    /**
     * ADR-031: the unsubscribe procedures are public, so they are throttled by
     * client IP — falling back to a shared bucket when the IP is unknown so a
     * missing header still throttles rather than bypasses.
     */
    const enforceUnsubscribeRateLimit = async ({
      ip,
      action,
      max,
    }: {
      ip: string | undefined;
      action: string;
      max: number;
    }): Promise<void> => {
      const limit = await ports.rateLimit({
        key: `unsubscribe:${action}:${ip ?? "unknown"}`,
        windowSeconds: 60,
        max,
      });
      if (!limit.allowed) {
        throw new UnsubscribeRateLimitedError();
      }
    };

    return trpc.router({
      /**
       * ADR-031: public token resolution for the `/unsubscribe` page. The token is
       * the authorization — its HMAC binds it to one recipient — so no login is
       * required. Returns masked email + project/trigger names, or NOT_FOUND on an
       * invalid/tampered token or a project that no longer exists.
       */
      resolveUnsubscribeToken: policy(UNSUBSCRIBE_TOKEN_IS_THE_AUTHORIZATION)(
        publicProcedure.input(resolveInputSchema),
      ).query(async ({ input, ctx }) => {
        await enforceUnsubscribeRateLimit({
          ip: ports.clientIp(ctx),
          action: "resolve",
          max: 30,
        });
        const view = await ctx.app.automation.tryResolveUnsubscribeView({
          token: input.token,
        });
        if (!view) {
          throw new UnsubscribeLinkInvalidError(
            "This unsubscribe link is invalid or has expired.",
            404,
          );
        }
        return view;
      }),

      /** Public one-click / button confirm. Idempotent — the suppression upsert
       *  collapses duplicates. */
      confirmUnsubscribe: policy(UNSUBSCRIBE_TOKEN_IS_THE_AUTHORIZATION)(
        publicProcedure.input(confirmInputSchema),
      ).mutation(async ({ input, ctx }) => {
        await enforceUnsubscribeRateLimit({
          ip: ports.clientIp(ctx),
          action: "confirm",
          max: 10,
        });
        try {
          await ctx.app.automation.confirmUnsubscribe({
            token: input.token,
            scope: input.scope,
          });
        } catch (err) {
          // A bad or tampered token is the recipient's problem, and they can
          // act on it: ask for the link again. A downstream persistence
          // failure is ours, has no action for them, and is re-raised exactly
          // as it arrived so it degrades to "unknown" plus a trace id at the
          // boundary rather than masquerading as an "invalid link".
          if (err instanceof InvalidUnsubscribeTokenError) {
            throw new UnsubscribeLinkInvalidError("This unsubscribe link is invalid.", 400);
          }
          throw err;
        }
        return { ok: true };
      }),

      /** Operator-facing suppression list (ADR-031). Each row is enriched with its
       *  trigger name (null triggerId = project-wide) so the table can render the
       *  scope without a second round-trip. */
      getAll: policy({ kind: "permission", permission: "triggers:view" })(
        procedure.input(projectScopeSchema),
      ).query(async ({ input, ctx }) => {
        const rows = await ctx.app.automation.getSuppressionsEnriched({
          projectId: input.projectId,
        });
        void ports.recordAudit({
          userId: ctx.actor().id,
          projectId: input.projectId,
          action: "emailSuppression.getAll",
          args: {
            recordCount: rows.length,
            triggerIds: [
              ...new Set(rows.map((r) => r.triggerId).filter((id): id is string => id != null)),
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
      remove: policy({ kind: "permission", permission: "triggers:manage" })(
        procedure.input(removeInputSchema),
      ).mutation(async ({ input, ctx }) => {
        await ctx.app.automation.removeSuppression({
          projectId: input.projectId,
          id: input.id,
        });
        void ports.recordAudit({
          userId: ctx.actor().id,
          projectId: input.projectId,
          action: "emailSuppression.remove",
          args: { suppressionId: input.id },
        });
        return { ok: true };
      }),
    });
  }
}
