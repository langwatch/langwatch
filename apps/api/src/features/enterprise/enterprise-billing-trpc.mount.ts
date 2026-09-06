/**
 * SaaS-only, but always mounted (empty router when `saasBilling` is false)
 * so self-hosted answers "no such procedure" rather than 404.
 */
import {
  CurrencyTrpcApi,
  SubscriptionTrpcApi,
  type CurrencyTrpcContext,
  type SubscriptionTrpcContext,
} from "@langwatch/enterprise-billing-server";
import { CURRENCY_NO_PERMISSION } from "@langwatch/enterprise-api";
import { appTrpcNoPermissionPolicy, appTrpcPolicy, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the two surfaces place on the process. */
export type EnterpriseBillingTrpcContext = CurrencyTrpcContext & SubscriptionTrpcContext;

/** The two Enterprise billing namespaces this process mounts. */
export function createEnterpriseBillingTrpcRouters<
  TContext extends EnterpriseBillingTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    Readonly<{
      /** Whether this installation bills through Stripe. */
      saasBilling: boolean;
    }>,
) {
  const billing = SubscriptionTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
    validateOutput: mount.validateOutput ?? false,
  });

  const currencyDetection = CurrencyTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    // The declaration is the process's, already written: the chain asks for a
    // policy by access, and this surface has exactly one.
    policy: () => appTrpcNoPermissionPolicy(mount.middlewares)(CURRENCY_NO_PERMISSION),
    validateOutput: mount.validateOutput ?? false,
  });

  // Typed as the served router either way, so the record always carries the
  // same shape and a client's inferred types do not depend on the deployment.
  return {
    currency: (mount.saasBilling
      ? currencyDetection
      : (mount.root.router({}) as unknown as typeof currencyDetection)) as typeof currencyDetection,
    subscription: (mount.saasBilling
      ? billing
      : (mount.root.router({}) as unknown as typeof billing)) as typeof billing,
  };
}
