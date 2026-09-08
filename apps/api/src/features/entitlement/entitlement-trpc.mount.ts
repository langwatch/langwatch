/** Binds the feature's declared procedures to this process's execution path. */
import { type EntitlementApi } from "@langwatch/entitlement-contract";
import {
  organizationSpendTrpcTransport,
  planTrpcTransport,
  usageLimitsTrpcTransport,
} from "@langwatch/entitlement-server";
import type { TrpcRuntime } from "@langwatch/api/trpc";

/** Mounts `plan.*` on the app process's tRPC root. */
export function createPlanTrpcRouter<TContext extends object>(
  runtime: TrpcRuntime<TContext>,
  app: EntitlementApi,
) {
  return runtime.mount(planTrpcTransport, () => app);
}

/** Mounts `limits.*` on the app process's tRPC root. */
export function createUsageLimitsTrpcRouter<TContext extends object>(
  runtime: TrpcRuntime<TContext>,
  app: EntitlementApi,
) {
  return runtime.mount(usageLimitsTrpcTransport, () => app);
}

/** Mounts `costs.*` on the app process's tRPC root. */
export function createOrganizationSpendTrpcRouter<TContext extends object>(
  runtime: TrpcRuntime<TContext>,
  app: EntitlementApi,
) {
  return runtime.mount(organizationSpendTrpcTransport, () => app);
}
