/**
 * App-process transport mount for the two Enterprise billing tRPC surfaces.
 *
 *   subscription.*  the paid plan an organization is on, and the checkout and
 *                   quote behind changing it
 *   currency.*      the currency a visitor is quoted in
 *
 * Both are SaaS-only, and both are MOUNTED either way. That is the difference
 * from serving nothing: a client asking what this deployment charges has to be
 * able to tell "this installation does not bill" from "the call failed", and a
 * namespace that simply is not there tells it neither. `saasBilling` false
 * yields an empty router of the served type — the same construction
 * `EnterpriseTrpcComposition` uses, restated here because this process mounts
 * these two and not the four that composition also builds.
 *
 * A self-hosted installation therefore answers "no such procedure" for each
 * verb while still carrying the namespace, rather than guessing a currency from
 * CDN headers only the hosted edge injects, or pretending to hold a Stripe
 * customer it never created.
 */
import {
  CurrencyTrpcApi,
  SubscriptionTrpcApi,
  type CurrencyTrpcContext,
  type SubscriptionTrpcContext,
} from "@langwatch/enterprise-billing-server";
import { CURRENCY_NO_PERMISSION } from "@langwatch/enterprise-api";
import {
  appTrpcNoPermissionPolicy,
  appTrpcPolicy,
  type TrpcApiMount,
} from "@langwatch/api/trpc";
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
  });

  const currencyDetection = CurrencyTrpcApi.create(mount.root, {
    protected: mount.protectedProcedure,
    noPermission: appTrpcNoPermissionPolicy(mount.middlewares)(CURRENCY_NO_PERMISSION),
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
