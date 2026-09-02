/**
 * The monitor package's host port, answered from this application.
 *
 * `@langwatch/monitor-web` declares what its screen needs — the project in
 * scope, the reader's grants, the projects a monitor may be replicated into,
 * the reader's time zone, the address, navigation, the two notices and the
 * overlays it does not own — as one abstract class it can define without
 * importing anything of ours. This is the other half: a plain adapter over the
 * capabilities the application shell already resolves.
 *
 * THE CHROME GAP IS THIS SIDE'S. Three of the screen's actions write a
 * `?drawer.open=…` address — `onlineEvaluation` for both create and edit, and
 * `guardrails`. Both drawers are registered in `platform/app` and mounted by
 * `DashboardPageBody`, which is application chrome a screen served from
 * `apps/ui` has nothing above it to supply, so the address changes and nothing
 * opens. It is the same recorded gap five families before this one carried, and
 * this family loses the most to it: creating an online evaluation is the page's
 * primary action.
 */

import type {
  MonitorCopyTarget,
  MonitorFailureNotice,
  MonitorOverlayRequest,
  MonitorRouteReading,
  MonitorScope,
  MonitorSuccessNotice,
} from "@langwatch/monitor-web/screens/online-evaluations";
import { MonitorHostPort } from "@langwatch/monitor-web/screens/online-evaluations";

/** The grant the platform page carried, unchanged. */
export const ONLINE_EVALUATIONS_PAGE_PERMISSION = "evaluations:view";

/** The grant a replication target is judged by. Monitors live under evaluations. */
export const MONITOR_COPY_PERMISSION = "evaluations:manage";

/**
 * How an overlay this family does not own is addressed.
 *
 * `platform/app`'s drawer registry reads `drawer.open` plus one query parameter
 * per prop, which is what `openDrawer(key, props)` wrote.
 */
export function overlayQuery(request: MonitorOverlayRequest): Record<string, string | undefined> {
  return {
    "drawer.open": request.drawer,
    ...Object.fromEntries(
      Object.entries(request.params ?? {}).map(([key, value]) => [`drawer.${key}`, value]),
    ),
  };
}

export type MonitorHostReadings = {
  scope: MonitorScope;
  hasPermission: (permission: string) => boolean;
  copyTargets: readonly MonitorCopyTarget[];
  timeZone: string;
  route: MonitorRouteReading;
};

export type MonitorHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: MonitorSuccessNotice) => void;
  failed: (failure: MonitorFailureNotice) => void;
};

export class UiMonitorHost extends MonitorHostPort {
  static create(readings: MonitorHostReadings, actions: MonitorHostActions): UiMonitorHost {
    return new UiMonitorHost(readings, actions);
  }

  private constructor(
    private readonly readings: MonitorHostReadings,
    private readonly actions: MonitorHostActions,
  ) {
    super();
  }

  scope(): MonitorScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  copyTargets(): readonly MonitorCopyTarget[] {
    return this.readings.copyTargets;
  }

  timeZone(): string {
    return this.readings.timeZone;
  }

  route(): MonitorRouteReading {
    return this.readings.route;
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  openOverlay(request: MonitorOverlayRequest): void {
    this.actions.setQuery({ ...this.readings.route.query, ...overlayQuery(request) });
  }

  succeeded(notice: MonitorSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: MonitorFailureNotice): void {
    this.actions.failed(failure);
  }
}
