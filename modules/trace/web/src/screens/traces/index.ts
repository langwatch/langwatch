/// <reference path="../../model/ambient.d.ts" />

import type { ComponentType } from "react";

export type TraceScreenLoader = () => Promise<{ default: ComponentType }>;

export const traceScreens = {
  traces: () => import("./traces.screen.tsx"),
  sharedTrace: () => import("./shared-trace.screen.tsx"),
} as const satisfies Record<string, TraceScreenLoader>;

export type TraceScreenName = keyof typeof traceScreens;

/**
 * The trace drawer's global mount, which the chrome renders once above the outlet —
 * beside its own `CurrentDrawer` and outside any page.
 */
export const traceDrawerMount: TraceScreenLoader = () =>
  import("../../ui/sections/explorer/global-trace-v2-drawer-mount.tsx").then((module) => ({
    default: module.GlobalTraceV2DrawerMount,
  }));

export { api as traceApi, api as traceApiHooks } from "../../behavior/trace-api.ts";
export type { RouterOutputs as TraceRouterOutputs, TraceApiMap } from "../../behavior/trace-api.ts";
export {
  TraceHostPort,
  TraceHostProvider,
  useOptionalTraceHost,
  useTraceHost,
  type TraceFailureAction,
  type TraceFailureNotice,
  type TraceHostOrganization,
  type TraceHostOrganizationRole,
  type TraceHostProject,
  type TraceHostTeam,
  type TraceHostUser,
  type TraceRouteReading,
  type TraceSuccessNotice,
} from "../../behavior/trace-host.ts";
/**
 * Binds the mounted host to the failure reporter these screens call.
 */
