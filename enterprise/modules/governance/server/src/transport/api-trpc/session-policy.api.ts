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
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  organizationSessionPolicySchema,
  governanceWriteAcknowledgedSchema,
} from "@langwatch/enterprise-governance-contract";
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

type SessionPolicyTrpcProcedures<
  TContext extends SessionPolicyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
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
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("get", (p) =>
        p
          .withInput(organizationScopeSchema)
          .withOutput(organizationSessionPolicySchema)
          .withPermission("organization:view")
          /** Current policy for the organization. */
          .handle(async ({ ctx, input }) => ctx.app.sessionPolicy.get(input.organizationId)),
      )
      .mutation("setMaxDuration", (p) =>
        p
          .withInput(setMaxDurationSchema)
          .withOutput(governanceWriteAcknowledgedSchema)
          .withPermission("organization:manage")
          /** Set `maxSessionDurationDays`; 0 is unbounded, capped at 365. */
          .handle(async ({ ctx, input }) => {
            await ctx.app.sessionPolicy.setMaxDurationDays(
              input.organizationId,
              input.maxSessionDurationDays,
            );
            return { ok: true };
          }),
      )
      .build();
  }
}
