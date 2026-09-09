/**
 * The Enterprise tRPC surfaces, composed for the legacy web application's
 * router root.
 *
 * Three transports live here: SCIM tokens (`scimToken`) and billing's two —
 * the paid subscription (`subscription`) and the currency a visitor is quoted
 * in (`currency`). The back office's `ssoConnections` and the two licensing
 * namespaces are mounted by the process itself, off their features' own
 * declared contracts. Each router's behaviour — procedure names, input and
 * output shapes, refusals — belongs to its Enterprise feature package. What
 * this composition owns is the wiring: which policy wraps which permission,
 * and which process capability answers each port.
 *
 * It sits in the Enterprise API composition rather than in `apps/api` because a
 * core package may not depend on an Enterprise one. Everything the process must
 * supply arrives through `create`, so this package never imports an
 * application.
 *
 * `subscription` and `currency` are SaaS-only: a self-hosted installation gets
 * an empty router of the same type rather than a surface that pretends to bill,
 * or one that guesses a currency from CDN headers only the hosted edge injects.
 */
import {
  CurrencyTrpcApi,
  SubscriptionTrpcApi,
  type CurrencyTrpcContext,
  type SubscriptionTrpcContext,
} from "@langwatch/enterprise-billing-server";
import {
  ScimTokenTrpcApi,
  type ScimTokenTrpcContext,
  type ScimPlanProvider,
  type ScimTokenTrpcPorts,
} from "@langwatch/enterprise-scim-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement these surfaces place on the process. */
export type EnterpriseTrpcContext = CurrencyTrpcContext &
  ScimTokenTrpcContext &
  SubscriptionTrpcContext;

/** One already-composed process policy, applied after a feature's input parser. */
type EnterpriseTrpcPolicy = <TProcedure>(procedure: TProcedure) => TProcedure;

/**
 * Why the quoted currency has nothing to check: the answer is read from the
 * request's own CDN headers, is identical for every caller in the same place,
 * and names no tenant. The declaration is the written record of that.
 */
export const CURRENCY_NO_PERMISSION = {
  reason: "currency catalog is public reference data",
} as const;

/** Explicit Enterprise tRPC transports; mounting stays application-owned. */
export class EnterpriseTrpcComposition {
  static create<
    TContext extends EnterpriseTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TScimTokenPorts extends ScimTokenTrpcPorts,
  >(options: {
    /** The process's one tRPC root; feature routers must not create a second. */
    root: TRPCRootObject<TContext, object, TOptions, TRoot>;
    /** The process's authenticated procedure. */
    protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
    /** The process's full policy chain for one declared permission. */
    policy(permission: "organization:view" | "organization:manage"): EnterpriseTrpcPolicy;
    /** The chain declaring `CURRENCY_NO_PERMISSION`. */
    currencyPolicy: EnterpriseTrpcPolicy;
    /** Whether this installation bills through Stripe. */
    saasBilling: boolean;
    /**
     * Check each answer against the output schema its procedure declared. The
     * process decides — production leaves it off, because a declared shape
     * documents the answer rather than gating it.
     */
    validateOutput: boolean;
    ports: {
      scimToken: TScimTokenPorts;
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

    const billing = SubscriptionTrpcApi.create(root, {
      protected: protectedProcedure,
      policy,
      validateOutput,
    });

    // SaaS-only: subscription management requires Stripe. Typed as the served
    // router either way, so the application router always carries the same
    // shape.
    const subscription: typeof billing = options.saasBilling
      ? billing
      : (root.router({}) as unknown as typeof billing);

    const currencyDetection = CurrencyTrpcApi.create(root, {
      protected: protectedProcedure,
      // The declaration is the process's, already written: the chain asks for
      // a policy by access, and this surface has exactly one.
      policy: () => options.currencyPolicy,
      validateOutput,
    });

    // SaaS-only for the same reason and by the same construction: geo-IP
    // detection reads headers only the hosted CDN injects, so a self-hosted
    // installation serves the shape and none of the guessing.
    const currency: typeof currencyDetection = options.saasBilling
      ? currencyDetection
      : (root.router({}) as unknown as typeof currencyDetection);

    return {
      currency,
      scimToken,
      subscription,
    };
  }
}
