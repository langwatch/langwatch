/**
 * App-process transport mounts for the automation vertical. Behaviour is package-owned
 * (`@langwatch/automation-server`); this supplies the process's root, its procedures, the
 * policy chain, and the ports the automation package does not own.
 */
import {
  AutomationTrpcApi,
  EmailSuppressionTrpcApi,
  type AutomationTrpcContext,
  type AutomationTrpcPorts,
  type EmailSuppressionTrpcContext,
  type EmailSuppressionTrpcPorts,
} from "@langwatch/automation-server";
import {
  createTrpcApiService,
  type TrpcApiMount,
  type TrpcApiPorts,
  type TrpcApiPublicMount,
} from "@langwatch/api/trpc";
import { TraceQueryClickHouseAdapter } from "@langwatch/trace-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The automation ports the composing process supplies.
 */
export type AutomationMountPorts = Omit<AutomationTrpcPorts, "assertTraceFilterQueryCompiles">;

/** Mounts `automation.*` on the app process's tRPC root. */
export function createAutomationTrpcRouter<
  TContext extends AutomationTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<AutomationMountPorts>) {
  return AutomationTrpcApi.create(mount.root, createTrpcApiService(mount), {
    ...mount.ports,
    // A dry run over a zero-width window: only whether the author's query
    // compiles is being asked, so the window never reaches ClickHouse.
    assertTraceFilterQueryCompiles: ({ query, projectId }) => {
      TraceQueryClickHouseAdapter.translateFilter(query, projectId, { from: 0, to: 0 });
    },
  });
}

/**
 * Mounts `emailSuppression.*` on the app process's tRPC root. The unsubscribe pair
 * arrives from a mail client, with no session, which is why this mount takes the
 * process's public procedure as well.
 */
export function createEmailSuppressionTrpcRouter<
  TContext extends EmailSuppressionTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPublicMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<EmailSuppressionTrpcPorts>,
) {
  return EmailSuppressionTrpcApi.create(mount.root, createTrpcApiService(mount), mount.ports);
}
