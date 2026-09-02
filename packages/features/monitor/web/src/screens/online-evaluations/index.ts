/**
 * The online evaluations family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/:project/online-evaluations`.
 *
 * WHY THIS IS ITS OWN PACKAGE, and not `@langwatch/evaluator-web`. The
 * credentials family's rule, read strictly: a key belongs to the family that
 * owns its TRANSPORT. Every write and the list itself are `monitors.*`, mounted
 * out of `@langwatch/monitor-server`, and the row type is
 * `@langwatch/monitor-contract`'s. The RBAC family's exception — the roles pages
 * went to `@langwatch/authz-web` though `role.*` is the role feature's — turns
 * on every TYPE on the page coming from the neighbour, and fails here: only the
 * evaluator's DISPLAY NAME is read out of `@langwatch/evaluator-contract`, from
 * a pure lookup table.
 *
 * The one thing that pointed the other way is recorded rather than suppressed:
 * `@langwatch/evaluator-web` published `online-evaluation-performance-preview`,
 * a component named for this page and consumed only by it. That is a
 * misplacement, not a claim of ownership, so the MODULE moved here rather than
 * the screen moving there — the gateway family's `RoutingPolicyRowActions`
 * ruling, applied a second time. The cost of the split is 154 lines, which is
 * two orders of magnitude below the number that overruled the rule for
 * analytics.
 *
 * A NEW PACKAGE FOR ONE SCREEN is the `@langwatch/organization-web` call taken
 * a third time: `monitor` is a wide contract and this will not be its only
 * surface — the online evaluation drawer, the guardrails drawer and the legacy
 * edit form are three more screens' worth of the same transport, each blocked
 * today for reasons recorded in the manifest rather than for want of a package.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the project, the
 * reader's grants, the replication targets, the time zone, navigation, the two
 * notices and the overlays this family does not own.
 */

import type { ComponentType } from "react";

export type MonitorScreenLoader = () => Promise<{ default: ComponentType }>;

export const monitorScreens = {
  onlineEvaluations: () => import("./online-evaluations.screen"),
} as const satisfies Record<string, MonitorScreenLoader>;

export type MonitorScreenName = keyof typeof monitorScreens;

export { ONLINE_EVALUATIONS_PAGE_PERMISSION } from "./online-evaluations.screen";
export { monitorApi } from "../../behavior/monitor-api";
export type {
  MonitorApiMap,
  MonitorExperimentRow,
  MonitorListRow,
} from "../../behavior/monitor-api";
export {
  MonitorHostPort,
  MonitorHostProvider,
  type MonitorCopyTarget,
  type MonitorFailureNotice,
  type MonitorOverlayRequest,
  type MonitorRouteReading,
  type MonitorScope,
  type MonitorSuccessNotice,
} from "../../model/monitor-host";
