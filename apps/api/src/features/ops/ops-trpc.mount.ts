/**
 * App-process transport mounts for the operator back office and the support
 * inbox beside it.
 *
 * The routers themselves are package-owned: `@langwatch/ops-server` decides the
 * procedure names, the input and output shapes and which service answers. What
 * this file owns is the wiring — which policy wraps `ops:view` and which wraps
 * `ops:manage`, and which process capability answers each port.
 *
 * Everything the process must supply arrives through these functions. This
 * package never imports the legacy application; the legacy application imports
 * this.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  BugReportTrpcApi,
  BUG_REPORTS_NO_PERMISSION,
  OpsTrpcApi,
  type BugReportTrpcContext,
  type BugReportTrpcPorts,
  type OpsTrpcContext,
  type OpsTrpcPorts,
} from "@langwatch/ops-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { policyForCheck, type AppTrpcPolicyKit } from "../../app-trpc/app-trpc.policy-kit";

export type { BugReportTrpcContext, OpsTrpcContext };

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

/**
 * Mounts `bugReports.*` on the app process's tRPC root.
 *
 * A separate mount rather than another surface on the operator router: this
 * one takes the ordinary feature mount, because its gate is the ordinary
 * opted-out declaration and not the operator scope. The written reason travels
 * from the package, which is where the fact it states — a bug report carries no
 * tenant, so there is no scope to check — actually belongs. `TListing` and
 * `TReport` are inferred from the process's own reader so the inbox reaches the
 * client with the shape it has always had.
 */
export function createBugReportTrpcRouter<
  TContext extends BugReportTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TListing,
  TReport,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<BugReportTrpcPorts<TListing, TReport>>,
) {
  const service = createTrpcApiService(mount);

  return BugReportTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      staffPolicy: service.noPermission(BUG_REPORTS_NO_PERMISSION),
    },
    mount.ports,
  );
}
