/**
 * The organization-scoped session-policy tRPC surface — the one admin knob
 * flipped from the governance settings page. Reads with `organization:view`,
 * writes with `organization:manage`. The service enforces the range so the
 * refusal and the copy stay in one place.
 *
 * Transport only: input parsing, wire shape, delegation to the service.
 *
 * Spec: specs/ai-governance/sessions/personal-sessions.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { OrganizationSessionPolicyService } from "#services/organization-session-policy.service";
import { SESSION_POLICY_MAX_DAYS } from "#services/organization-session-policy.service";

/** The service slice this feature reaches through on the shared tRPC context. */
export type SessionPolicyTrpcContext = Readonly<{
  app: Readonly<{
    sessionPolicy: OrganizationSessionPolicyService;
  }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type SessionPolicyTrpcProcedures<
  TContext extends SessionPolicyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

const setMaxDurationSchema = organizationScopeSchema.extend({
  maxSessionDurationDays: z.number().int().min(0).max(SESSION_POLICY_MAX_DAYS),
});

/** Installs the `sessionPolicy.*` tRPC surface on a process root. */
export class SessionPolicyTrpcApi {
  static create<
    TContext extends SessionPolicyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SessionPolicyTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /** Current policy for the organization. */
      get: policy("organization:view")(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) => ctx.app.sessionPolicy.get(input.organizationId),
      ),

      /** Set `maxSessionDurationDays`; 0 = unbounded, capped at 365. */
      setMaxDuration: policy("organization:manage")(procedure.input(setMaxDurationSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.sessionPolicy.setMaxDurationDays(
            input.organizationId,
            input.maxSessionDurationDays,
          );
          return { ok: true };
        },
      ),
    });
  }
}
