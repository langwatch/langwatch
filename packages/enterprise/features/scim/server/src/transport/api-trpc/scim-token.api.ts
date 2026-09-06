/**
 * SCIM provisioning tokens over the process's tRPC transport.
 *
 *   list:     the organization's tokens, as the settings page shows them.
 *   generate: mints one for a directory connection; the secret is returned
 *             once and never again.
 *   revoke:   retires one, so the directory it belonged to stops provisioning.
 *
 * Every procedure takes `organization:manage`: a SCIM token writes members into
 * the organization, so minting one is the same authority as inviting anybody.
 * The Enterprise plan gate runs SECOND, after the permission check, so a caller
 * who does not belong to the organization is told that rather than being told
 * what the organization has not bought.
 *
 * Transport only: gates, input shapes and delegation to `ScimService`. The plan
 * gate arrives already built, because the plan is the process's answer and not
 * SCIM's.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import {
  issuedScimTokenSchema,
  scimTokenRevokedSchema,
  scimTokenSummarySchema,
} from "@langwatch/enterprise-scim-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { ScimApp, ScimPlanProvider } from "#app/scim.app";

/**
 * The process supplies authentication; authorization arrives as a policy.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type ScimTokenTrpcContext = Readonly<{
  app: Readonly<{ scimApp: ScimApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type ScimTokenTrpcProcedures<
  TContext extends ScimTokenTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission, applied AFTER this feature's own
   * input parser so the check reads its organization id from validated input.
   */
  policy(permission: "organization:manage"): TrpcPolicyDecorator;
  /**
   * Refuses the call unless the organization is on an Enterprise plan, using
   * this feature's own plan provider. The process builds it from
   * {@link ScimTokenTrpcPorts.requireEnterprisePlan}; installing a middleware
   * is not something this package names tRPC's builder internals to do.
   */
  planGate: TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** The process capabilities this transport needs that are not SCIM's own. */
export type ScimTokenTrpcPorts = Readonly<{
  /**
   * Refuses the call unless the organization is on an Enterprise plan. Composed
   * after the permission check on purpose: "you don't have access to the
   * organization" is a clearer answer than "your organization has not bought
   * this" for somebody who has neither.
   */
  requireEnterprisePlan(
    input: Readonly<{
      planProvider: ScimPlanProvider;
      organizationId: string;
    }>,
  ): Promise<void>;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

/** Installs the complete `scimToken.*` tRPC surface on a process-owned root. */
export class ScimTokenTrpcApi {
  static create<
    TContext extends ScimTokenTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ScimTokenTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, planGate, validateOutput } = procedures;
    const manage = policy("organization:manage");

    /**
     * `organization:manage`, and only then the Enterprise plan gate. Composed
     * in that order on purpose: "you don't have access to this organization"
     * is a clearer answer than "your organization has not bought this" for
     * somebody who has neither.
     */
    const enterpriseScimAccess: TrpcPolicyDecorator = (built) => planGate(manage(built));

    const ENTERPRISE_SCIM =
      "organization:manage — minting a SCIM token is the same authority as inviting anybody — and then the Enterprise plan gate";

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(organizationScopeSchema)
          .withOutput(scimTokenSummarySchema.array())
          .withCustomPermission(enterpriseScimAccess, ENTERPRISE_SCIM)
          /** The organization's tokens, as the settings page shows them. */
          .handle(async ({ ctx, input }) =>
            ctx.app.scimApp.listTokens({ organizationId: input.organizationId }),
          ),
      )
      .mutation("generate", (p) =>
        p
          .withInput(
            organizationScopeSchema.extend({
              description: z.string().optional(),
              // D08: which connection this token is for. Optional on the wire
              // and required by the service, so a client that has not been
              // updated gets the named `scim_connection_required` refusal
              // rather than a schema error the customer cannot read.
              connectionId: z.string().optional(),
            }),
          )
          .withOutput(issuedScimTokenSchema)
          .withCustomPermission(enterpriseScimAccess, ENTERPRISE_SCIM)
          /** Mints one for a directory connection; the secret is answered once. */
          .handle(async ({ ctx, input }) =>
            ctx.app.scimApp.generateToken({
              organizationId: input.organizationId,
              connectionId: input.connectionId,
              description: input.description,
            }),
          ),
      )
      .mutation("revoke", (p) =>
        p
          .withInput(organizationScopeSchema.extend({ tokenId: z.string() }))
          .withOutput(scimTokenRevokedSchema)
          .withCustomPermission(enterpriseScimAccess, ENTERPRISE_SCIM)
          /** Retires one, so the directory it belonged to stops provisioning. */
          .handle(async ({ ctx, input }) =>
            ctx.app.scimApp.revokeToken({
              organizationId: input.organizationId,
              tokenId: input.tokenId,
            }),
          ),
      )
      .build();
  }
}
