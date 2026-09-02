/**
 * The analytics package's host port, answered from this application.
 *
 * `@langwatch/analytics-web` declares what its eight screens need — the project
 * in scope, the organization, the reader's grants, the address, and the two
 * notices — as one abstract class it can define without importing anything of
 * ours. This is the other half: a plain adapter over the capabilities the
 * application shell already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * THE CHROME GAP IS THIS SIDE'S, and it is recorded rather than papered over.
 * One action on these screens writes a `?drawer.open=…` address — opening a
 * trace from the users page's feedback table (`traceV2Details`). That drawer is
 * registered in `platform/app` and mounted by `DashboardPageBody`, which is
 * application chrome a screen served from `apps/ui` has nothing above it to
 * supply. So the address changes and nothing opens, exactly as the
 * coding-agent, me, automations and annotations families recorded for the same
 * registry. The address is still the right thing to write: it is what makes the
 * overlay come back for free when the chrome layout route lands, and it is what
 * a shared link already means.
 */

import type {
  AnalyticsFailureNotice,
  AnalyticsHostProject,
  AnalyticsRouteReading,
  AnalyticsSuccessNotice,
} from "@langwatch/analytics-web/screens/analytics";
import { AnalyticsHostPort } from "@langwatch/analytics-web/screens/analytics";

/** The grant every one of the nine platform pages asked for, unchanged. */
export const ANALYTICS_PAGE_PERMISSION = "analytics:view";

export type AnalyticsHostReadings = {
  project: AnalyticsHostProject | undefined;
  organizationId: string | undefined;
  hasPermission: (permission: string) => boolean;
  route: AnalyticsRouteReading;
};

export type AnalyticsHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: AnalyticsSuccessNotice) => void;
  failed: (failure: AnalyticsFailureNotice) => void;
};

export class UiAnalyticsHost extends AnalyticsHostPort {
  static create(readings: AnalyticsHostReadings, actions: AnalyticsHostActions): UiAnalyticsHost {
    return new UiAnalyticsHost(readings, actions);
  }

  private constructor(
    private readonly readings: AnalyticsHostReadings,
    private readonly actions: AnalyticsHostActions,
  ) {
    super();
  }

  project(): AnalyticsHostProject | undefined {
    return this.readings.project;
  }

  organizationId(): string | undefined {
    return this.readings.organizationId;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  route(): AnalyticsRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  succeeded(notice: AnalyticsSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: AnalyticsFailureNotice): void {
    this.actions.failed(failure);
  }
}
