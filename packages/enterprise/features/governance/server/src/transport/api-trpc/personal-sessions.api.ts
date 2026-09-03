/**
 * The devices-inventory tRPC surface — Sessions/Devices dashboard, Phase 8.
 *
 * Three procedures: list the caller's own active CLI sessions, revoke one by
 * `sessionStartedAtMs`, or revoke all. Every user is authorized on their OWN
 * sessions — an admin permission would only widen this to someone else's, and
 * this surface never does. The caller's id comes from `ctx.actor()`, never
 * from input, so no cross-user reach is expressible.
 *
 * Transport only: input parsing, wire shape, delegation. The revocation and
 * listing behaviour belong to {@link GovernanceService}, which both this
 * feature's transports reach through.
 *
 * Spec: specs/ai-governance/sessions/sessions-inventory.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/**
 * The process supplies authentication and the governance service; authorization
 * arrives as the policy. `app.governance` is the service slice this feature
 * reaches — a tRPC root is shared by every feature mounted on it and so
 * carries every feature's dependencies.
 */
export type PersonalSessionsTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type PersonalSessionsTrpcProcedures<
  TContext extends PersonalSessionsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the check and audit for
   * one declared permission, applied AFTER this feature's input parser.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

const revokeSchema = organizationScopeSchema.extend({
  sessionStartedAtMs: z.number().int().nonnegative(),
});

/** Installs the complete `personalSessions.*` tRPC surface on a process root. */
export class PersonalSessionsTrpcApi {
  static create<
    TContext extends PersonalSessionsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PersonalSessionsTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * The caller's own active CLI sessions, one card per device.
       *
       * `organization:view` is the base membership check the surface shares
       * with every other governance page. The actual reach is the caller's
       * userId, from `ctx.actor()`, never from input.
       */
      list: policy("organization:view")(
        procedure.input(organizationScopeSchema),
      ).query(async ({ ctx }) => {
        const sessions = await ctx.app.governance.cliSessionListForUser({
          userId: ctx.actor().id,
        });
        return sessions.map((session) => ({
          sessionStartedAtMs: session.sessionStartedAtMs,
          deviceLabel: session.deviceLabel,
          hostname: session.hostname,
          uname: session.uname,
          platform: session.platform,
          lastSeenMs: session.lastSeenMs,
          expiresAtMs: session.expiresAtMs,
        }));
      }),

      /** Revoke one of the caller's own sessions. Idempotent. */
      revoke: policy("organization:view")(procedure.input(revokeSchema)).mutation(
        async ({ ctx, input }) => {
          const result = await ctx.app.governance.cliSessionRevoke({
            userId: ctx.actor().id,
            sessionStartedAtMs: input.sessionStartedAtMs,
          });
          return { ok: true, revokedTokens: result.revokedTokens };
        },
      ),

      /**
       * Revoke every session for the caller ("log out everywhere"). Reuses
       * the user-wide token revoke so the per-user token index clears in one
       * shot.
       */
      revokeAll: policy("organization:view")(
        procedure.input(organizationScopeSchema),
      ).mutation(async ({ ctx }) => {
        const result = await ctx.app.governance.cliTokenRevokeForUser({
          userId: ctx.actor().id,
        });
        return { ok: true, revokedTokens: result.revokedCount };
      }),
    });
  }
}
