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
 * gate is a port, because the plan is the process's answer and not SCIM's.
 */
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
  policy(permission: "organization:manage"): <TProcedure>(procedure: TProcedure) => TProcedure;
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
    TPorts extends ScimTokenTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ScimTokenTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    const enterpriseScimProcedure = policy("organization:manage")(
      procedure.input(organizationScopeSchema),
    ).use(async ({ ctx, input, next }) => {
      await ports.requireEnterprisePlan({
        planProvider: ctx.app.scimApp.planProvider,
        organizationId: input.organizationId,
      });
      return next();
    });

    return trpc.router({
      list: enterpriseScimProcedure.query(async ({ ctx, input }) => {
        return ctx.app.scimApp.listTokens({ organizationId: input.organizationId });
      }),

      generate: enterpriseScimProcedure
        .input(
          z.object({
            description: z.string().optional(),
            // D08: which connection this token is for. Optional on the wire and
            // required by the service, so a client that has not been updated
            // gets the named `scim_connection_required` refusal rather than a
            // schema error the customer cannot read.
            connectionId: z.string().optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          return ctx.app.scimApp.generateToken({
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            description: input.description,
          });
        }),

      revoke: enterpriseScimProcedure
        .input(z.object({ tokenId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          return ctx.app.scimApp.revokeToken({
            organizationId: input.organizationId,
            tokenId: input.tokenId,
          });
        }),
    });
  }
}
