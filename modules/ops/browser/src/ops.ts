/** Ops workspace loaders (per-page, not barrel—thirteen thousand lines, Foundry loads
 * xyflow/Monaco/OTel). ADR-004 one entry; six Backoffice resources share one screen. */

import type { ComponentType } from "react";

export type OpsScreenLoader = () => Promise<{ default: ComponentType<never> }>;

export const opsScreens = {
  dashboard: () => import("./ui/sections/ops/ops-dashboard.screen.tsx"),
  eventSourcing: () => import("./ui/sections/ops/ops-event-sourcing.screen.tsx"),
  deadLetters: () => import("./ui/sections/ops/ops-dead-letters.screen.tsx"),
  processes: () => import("./ui/sections/ops/ops-processes.screen.tsx"),
  projections: () => import("./ui/sections/ops/ops-projections.screen.tsx"),
  subscribers: () => import("./ui/sections/ops/ops-subscribers.screen.tsx"),
  schedules: () => import("./ui/sections/ops/ops-schedules.screen.tsx"),
  payloadStore: () => import("./ui/sections/ops/ops-payload-store.screen.tsx"),
  dejaView: () => import("./ui/sections/ops/ops-deja-view.screen.tsx"),
  featureFlags: () => import("./ui/sections/ops/ops-feature-flags.screen.tsx"),
  foundry: () => import("./ui/sections/ops/ops-foundry.screen.tsx"),
  migrations: () => import("./ui/sections/ops/ops-migrations.screen.tsx"),
  replayProgress: () => import("./ui/sections/ops/ops-replay-progress.screen.tsx"),
  backoffice: () => import("./ui/sections/ops/ops-backoffice.screen.tsx"),
} as const satisfies Record<string, OpsScreenLoader>;

export type OpsScreenName = keyof typeof opsScreens;

export { BACKOFFICE_RESOURCES, type BackofficeResource } from "./model/backoffice-resources.ts";
export { opsApi } from "./behavior/ops-api.ts";
export {
  OpsHostApi,
  OpsHostProvider,
  type OpsFailureNotice,
  type OpsProject,
  type OpsRouteReading,
  type OpsSuccessNotice,
} from "./model/ops-host.ts";
