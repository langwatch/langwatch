/**
 * The Data Privacy package's host port, answered from this application.
 *
 * The narrower sibling of the retention adapter: privacy has no plan gate and
 * no platform-admin capability, so the screen asks only for the scope, the
 * address and the two notices. Nothing here fetches — the values arrive as
 * arguments, so the adapter is a value object a test can construct.
 */

import {
  DataPrivacyHostPort,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "@langwatch/data-privacy-web/screens/data-privacy";

/** The grant the platform page asked for, unchanged. */
export const DATA_PRIVACY_PAGE_PERMISSION = "project:view";

export type DataPrivacyHostReadings = {
  scope: PrivacyHostScope;
  route: PrivacyRouteReading;
};

export type DataPrivacyHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  succeeded: (notice: PrivacySuccessNotice) => void;
  failed: (failure: PrivacyFailureNotice) => void;
};

export class UiDataPrivacyHost extends DataPrivacyHostPort {
  static create(
    readings: DataPrivacyHostReadings,
    actions: DataPrivacyHostActions,
  ): UiDataPrivacyHost {
    return new UiDataPrivacyHost(readings, actions);
  }

  private constructor(
    private readonly readings: DataPrivacyHostReadings,
    private readonly actions: DataPrivacyHostActions,
  ) {
    super();
  }

  scope(): PrivacyHostScope {
    return this.readings.scope;
  }

  route(): PrivacyRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  succeeded(notice: PrivacySuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: PrivacyFailureNotice): void {
    this.actions.failed(failure);
  }
}
