/**
 * App-process transport mounts for the automation vertical.
 *
 * Behaviour is package-owned (`@langwatch/automation-server`); this supplies
 * the process's root, its procedures, the policy chain, and the ports the
 * automation package does not own.
 *
 * One of those ports is supplied here rather than by the composing process:
 * the trace-filter dry run is `@langwatch/trace-server`'s compiler, which this
 * process already depends on, and routing it through the composition root
 * would only move the same import one file further away from the transport
 * that needs it.
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
import { translateFilterToClickHouse } from "@langwatch/trace-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The automation ports the composing process supplies. Each reaches a
 * capability automation does not own: the shared rate-limit counter, the
 * provider registry's secret handling (the encryption key is the
 * deployment's), and the Slack channel listing, which goes out through the
 * process's own SSRF-checked HTTP client.
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
      translateFilterToClickHouse(query, projectId, { from: 0, to: 0 });
    },
  });
}

/**
 * Mounts `emailSuppression.*` on the app process's tRPC root.
 *
 * The unsubscribe pair arrives from a mail client, with no session, which is
 * why this mount takes the process's public procedure as well.
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
