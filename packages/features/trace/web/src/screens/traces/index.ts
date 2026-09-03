/// <reference path="../../model/ambient.d.ts" />
/**
 * The trace family, as the browser application mounts it.
 *
 * TWO SCREENS, TWO ADDRESSES: `/:project/traces` — the Trace Explorer, the
 * largest surface in the product — and `/share/:id`, the read-only view a share
 * link lands on.
 *
 * WHY THIS PACKAGE. The credentials family's rule, read strictly: a key belongs
 * to the family that owns its TRANSPORT. Both addresses call `tracesV2.*`,
 * `traces.*`, `traceEditOverlay.*` and `sharedTrace.*`, all mounted out of
 * `@langwatch/trace-server`, and every payload on them is
 * `@langwatch/trace-contract`'s. The auth front door's manifest already made
 * the call for `/share/:id` in as many words — "it is the TRACE family's page
 * … it moves with traces" — and this is that move.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the project, the
 * organization, the reader, their grants, the address, the two notices and the
 * overlays this family does not own.
 *
 * THE SHARED PAGE TAKES NO GUARD, and that absence is deliberate: a share link
 * is read by someone who may have no account at all. The explorer takes
 * `traces:view`, which is the grant `platform/app`'s page carried.
 */

import type { ComponentType } from "react";

export type TraceScreenLoader = () => Promise<{ default: ComponentType }>;

export const traceScreens = {
  traces: () => import("./traces.screen"),
  sharedTrace: () => import("./shared-trace.screen"),
} as const satisfies Record<string, TraceScreenLoader>;

export type TraceScreenName = keyof typeof traceScreens;

export { api as traceApi, api as traceApiHooks } from "../../ui/sections/trace-api";
export type { RouterOutputs as TraceRouterOutputs, TraceApiMap } from "../../ui/sections/trace-api";
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
} from "../../behavior/trace-host";
/**
 * Binds the mounted host to the failure reporter these screens call.
 *
 * A singleton rather than a hook because most failures are reported from a
 * mutation's `onError`, where no hook can run. The application's host provider
 * sets it on mount and clears it on unmount.
 */
export { setTraceErrorHost } from "../../behavior/errors/logic/show-error-toast";
