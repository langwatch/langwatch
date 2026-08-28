/**
 * App-process transport mount for the operator back office.
 *
 * The router itself is package-owned: `@langwatch/ops-server` decides the
 * procedure names, the input and output shapes and which service answers. What
 * this file owns is the wiring — which policy wraps `ops:view` and which wraps
 * `ops:manage`, and which process capability answers each port.
 *
 * Everything the process must supply arrives through `createOpsTrpcRouter`.
 * This package never imports the legacy application; the legacy application
 * imports this.
 */
import { OpsTrpcApi, type OpsTrpcContext, type OpsTrpcPorts } from "@langwatch/ops-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { policyForCheck, type AppTrpcPolicyKit } from "../../app-trpc/app-trpc.policy-kit";

export type { OpsTrpcContext };

/** Installs the `ops.*` back-office surface on the process's tRPC root. */
export function createOpsTrpcRouter<
  TContext extends OpsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends OpsTrpcPorts,
>(deps: {
  /** The process's one tRPC root; feature routers must not create a second. */
  root: TRPCRootObject<TContext, object, TOptions, TRoot>;
  /** The process's authenticated procedure. */
  protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's tracing, logging, error, lineage, check and audit chain. */
  policy: AppTrpcPolicyKit;
  /** The operations capabilities that are not the operations service's own. */
  ports: TPorts;
}) {
  const { root, protectedProcedure, policy, ports } = deps;

  return OpsTrpcApi.create(
    root,
    {
      protected: protectedProcedure,
      policy: (permission) => policyForCheck(policy, policy.checkOpsPermission({ permission })),
      // Status-probe variant: populates the operator scope without refusing, so
      // the global menu can poll it on every page load (lw#3584).
      probePolicy: policyForCheck(
        policy,
        policy.checkOpsPermission({
          permission: "ops:view",
          throwOnDeny: false,
        }),
      ),
    },
    ports,
  );
}
