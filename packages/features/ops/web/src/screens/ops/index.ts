/**
 * A CONSUMER COMPILES THIS PACKAGE'S SOURCE, so the ambient declaration the
 * Foundry's graph view relies on has to be reachable from this entry. Workspace
 * packages resolve to each other's `src`, and `@xyflow/react/dist/style.css` is
 * a side-effect import with no types of its own; the declaration that satisfies
 * it lives in this package's `include` and nowhere a consumer would look, so
 * the reference below is what carries it across.
 */
/// <reference path="../../features/foundry/model/xyflow.css.d.ts" />

/**
 * The Ops workspace, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes is a
 * loader per page rather than fourteen components: the workspace is thirteen
 * thousand lines and the Foundry alone drags xyflow, Monaco and a browser OTel
 * exporter, so a barrel would put all of it in one chunk the moment any address
 * under /ops is opened. A loader keeps the split the application already had.
 *
 * The keys are this package's names for its own pages. Which URL each answers
 * is `apps/ui`'s to decide — the route table names a page key, the frontend
 * feature maps that key onto one of these, and neither half learns the other's
 * vocabulary. TWENTY ADDRESSES, FOURTEEN LOADERS: the six Backoffice resources
 * are one screen taking the resource as a prop, which is the shape the
 * automations family established for its four tabs.
 *
 * `opsApi` and `OpsHostProvider` are the two things the owning frontend feature
 * has to mount around them: the tRPC Provider the surfaces' hooks run on, and
 * the port that answers for operator access, the address and the notices.
 */

import type { ComponentType } from "react";

export type OpsScreenLoader = () => Promise<{ default: ComponentType<never> }>;

export const opsScreens = {
  dashboard: () => import("./ops-dashboard.screen.tsx"),
  eventSourcing: () => import("./ops-event-sourcing.screen.tsx"),
  deadLetters: () => import("./ops-dead-letters.screen.tsx"),
  processes: () => import("./ops-processes.screen.tsx"),
  projections: () => import("./ops-projections.screen.tsx"),
  subscribers: () => import("./ops-subscribers.screen.tsx"),
  schedules: () => import("./ops-schedules.screen.tsx"),
  payloadStore: () => import("./ops-payload-store.screen.tsx"),
  dejaView: () => import("./ops-deja-view.screen.tsx"),
  featureFlags: () => import("./ops-feature-flags.screen.tsx"),
  foundry: () => import("./ops-foundry.screen.tsx"),
  migrations: () => import("./ops-migrations.screen.tsx"),
  replayProgress: () => import("./ops-replay-progress.screen.tsx"),
  backoffice: () => import("./ops-backoffice.screen.tsx"),
} as const satisfies Record<string, OpsScreenLoader>;

export type OpsScreenName = keyof typeof opsScreens;

export { BACKOFFICE_RESOURCES, type BackofficeResource } from "./ops-backoffice.screen.tsx";
export { opsApi } from "../../behavior/ops-api.ts";
export {
  OpsHostPort,
  OpsHostProvider,
  type OpsFailureNotice,
  type OpsProject,
  type OpsRouteReading,
  type OpsSuccessNotice,
} from "../../model/ops-host.ts";
