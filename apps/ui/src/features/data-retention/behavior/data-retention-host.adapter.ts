/**
 * The Data Retention package's host port, answered from this application.
 *
 * `@langwatch/data-retention-web` declares what its screen, its drawer and its
 * two confirm dialogs need — the scope, one grant, the plan tier, the
 * platform-admin flag, the scopes the reader can see, the address and the two
 * notices — as one abstract class it can define without importing anything of
 * ours. This is the other half: a plain adapter over what the application shell
 * has already resolved.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import {
  DataRetentionHostPort,
  type RetentionAvailableScopes,
  type RetentionFailureNotice,
  type RetentionHostScope,
  type RetentionRouteReading,
  type RetentionSuccessNotice,
} from "@langwatch/data-retention-web/screens/data-retention";

/** The grant the platform page asked for, unchanged. */
export const DATA_RETENTION_PAGE_PERMISSION = "project:view";

export type DataRetentionHostReadings = {
  scope: RetentionHostScope;
  availableScopes: RetentionAvailableScopes;
  isPlatformAdmin: boolean;
  isEnterprise: boolean;
  route: RetentionRouteReading;
};

export type DataRetentionHostActions = {
  hasPermission: (permission: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  succeeded: (notice: RetentionSuccessNotice) => void;
  failed: (failure: RetentionFailureNotice) => void;
};

export class UiDataRetentionHost extends DataRetentionHostPort {
  static create(
    readings: DataRetentionHostReadings,
    actions: DataRetentionHostActions,
  ): UiDataRetentionHost {
    return new UiDataRetentionHost(readings, actions);
  }

  private constructor(
    private readonly readings: DataRetentionHostReadings,
    private readonly actions: DataRetentionHostActions,
  ) {
    super();
  }

  scope(): RetentionHostScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  availableScopes(): RetentionAvailableScopes {
    return this.readings.availableScopes;
  }

  isPlatformAdmin(): boolean {
    return this.readings.isPlatformAdmin;
  }

  isEnterprise(): boolean {
    return this.readings.isEnterprise;
  }

  route(): RetentionRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  succeeded(notice: RetentionSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: RetentionFailureNotice): void {
    this.actions.failed(failure);
  }
}
