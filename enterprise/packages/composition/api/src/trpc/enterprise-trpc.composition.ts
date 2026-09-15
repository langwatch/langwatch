/**
 * One Enterprise tRPC surface: SCIM tokens. Billing, single sign-on and
 * licensing are mounted by the process off their own declared contracts. It
 * sits here because a core package may not depend on an Enterprise one.
 */
import {
  ScimTokenTrpcApi,
  type ScimTokenTrpcContext,
  type ScimPlanProvider,
  type ScimTokenTrpcMembers,
} from "@langwatch/enterprise-scim-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement these surfaces place on the process. */
export type EnterpriseTrpcContext = ScimTokenTrpcContext;

/** One already-composed process policy, applied after a feature's input parser. */
type EnterpriseTrpcPolicy = <TProcedure>(procedure: TProcedure) => TProcedure;

/** Explicit Enterprise tRPC transports; mounting stays application-owned. */
export class EnterpriseTrpcComposition {
  static create<
    TContext extends EnterpriseTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TScimTokenMembers extends ScimTokenTrpcMembers,
  >(options: {
    /** The process's one tRPC root; feature routers must not create a second. */
    root: TRPCRootObject<TContext, object, TOptions, TRoot>;
    /** The process's authenticated procedure. */
    protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
    /** The process's full policy chain for one declared permission. */
    policy(permission: "organization:view" | "organization:manage"): EnterpriseTrpcPolicy;
    /**
     * Check each answer against the output schema its procedure declared. The
     * process decides — production leaves it off, because a declared shape
     * documents the answer rather than gating it.
     */
    validateOutput: boolean;
    ports: {
      scimToken: TScimTokenMembers;
    };
  }) {
    const { root, protectedProcedure, policy, ports, validateOutput } = options;

    // The one place SCIM's plan gate becomes a decorator. The refusal reads
    // the SCIM application's own plan provider rather than the process-wide
    // one, which is why it is built here from the port instead of reusing the
    // shared `requireEnterprisePlan` middleware.
    const scimPlanGate = <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as unknown as { use: (m: unknown) => TProcedure }).use(
        async ({
          ctx,
          input,
          next,
        }: {
          ctx: { app: { scimApp: { planProvider: ScimPlanProvider } } };
          input: { organizationId: string };
          next: () => Promise<unknown>;
        }) => {
          await ports.scimToken.requireEnterprisePlan({
            planProvider: ctx.app.scimApp.planProvider,
            organizationId: input.organizationId,
          });
          return next();
        },
      );

    const scimToken = ScimTokenTrpcApi.create(root, {
      protected: protectedProcedure,
      policy,
      planGate: scimPlanGate,
      validateOutput,
    });

    return { scimToken };
  }
}
