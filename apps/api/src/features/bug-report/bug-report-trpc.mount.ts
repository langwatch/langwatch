/**
 * App-process transport mount for the support inbox. A separate mount rather than another
 * surface on the operator router: this one takes the ordinary feature mount, because its
 * gate is the ordinary opted-out declaration and not the operator scope.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import {
  BugReportTrpcApi,
  BUG_REPORTS_NO_PERMISSION,
  type BugReportTrpcContext,
  type BugReportTrpcPorts,
} from "@langwatch/ops-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

export type { BugReportTrpcContext };

/** Mounts `bugReports.*` on the app process's tRPC root. */
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
