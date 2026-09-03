/**
 * App-process transport mount for real-time evaluation monitors.
 *
 * Behaviour is package-owned (`@langwatch/monitor-server`); this supplies the
 * process's tRPC root, its authenticated procedure and its policy chain.
 *
 * One surface on this root needs something the shared service does not
 * publish: `monitors.getPerformanceForProject` requires `evaluations:view` AND
 * `analytics:view`, and that AND-composition is the only one in the codebase.
 * It is built here from the same `declaredCheck` the policy chain installs, so
 * the second permission is a DECLARED check the router sweep counts rather
 * than an extra middleware nothing records.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  MonitorTrpcApi,
  type MonitorTrpcContext,
  type MonitorTrpcPorts,
} from "@langwatch/monitor-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The `.use()` surface every tRPC procedure builder shares. Named at the one
 * seam that stacks a second declared check onto a builder whose input generics
 * belong to the feature package, so the composition below needs no `any`.
 */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

/** Mounts `monitors.*` on the app process's tRPC root. */
export function createMonitorTrpcRouter<
  TContext extends MonitorTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(options: TrpcApiMount<TContext, TOptions, TRoot> & Readonly<{ ports: MonitorTrpcPorts }>) {
  const service = createTrpcApiService(options);
  const alsoRequire =
    (permission: AuthzPermission) =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as unknown as ChainableProcedure).use(
        options.middlewares.declaredCheck({ kind: "permission", permission }),
      ) as unknown as TProcedure;

  return MonitorTrpcApi.create(
    options.root,
    { protected: service.protected, policy: service.policy, alsoRequire },
    options.ports,
  );
}
