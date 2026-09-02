/**
 * The organization package's host port, answered from this application.
 *
 * `@langwatch/organization-web` declares what its screen needs — the
 * organization graph, one grant, the address, the project switcher, a file to
 * hand over and one notice — as one abstract class it can define without
 * importing anything of ours. This is the other half: a plain adapter over what
 * the application shell has already resolved.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import {
  OrganizationHostPort,
  type OrganizationDownload,
  type OrganizationFailureNotice,
  type OrganizationReading,
  type OrganizationRouteReading,
  type OrganizationScope,
} from "@langwatch/organization-web/screens/organization";
import type { ReactNode } from "react";

/**
 * The grant the audit-log key carries.
 *
 * `organization:manage`, one for one with the platform page's
 * `withPermissionGuard`. The audit trail names who did what from every address
 * in the organization, so it is an administrator's surface: a member holding
 * `organization:view` reads their own organization's settings and not its
 * history.
 */
export const AUDIT_LOG_PAGE_PERMISSION = "organization:manage";

export type OrganizationHostReadings = {
  scope: OrganizationScope;
  organization: OrganizationReading | undefined;
  route: OrganizationRouteReading;
  projectSwitcher: ReactNode | null;
};

export type OrganizationHostActions = {
  hasPermission: (permission: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  download: (file: OrganizationDownload) => void;
  failed: (failure: OrganizationFailureNotice) => void;
};

export class UiOrganizationHost extends OrganizationHostPort {
  static create(
    readings: OrganizationHostReadings,
    actions: OrganizationHostActions,
  ): UiOrganizationHost {
    return new UiOrganizationHost(readings, actions);
  }

  private constructor(
    private readonly readings: OrganizationHostReadings,
    private readonly actions: OrganizationHostActions,
  ) {
    super();
  }

  scope(): OrganizationScope {
    return this.readings.scope;
  }

  organization(): OrganizationReading | undefined {
    return this.readings.organization;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  route(): OrganizationRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  /**
   * A RECORDED GAP, answered honestly rather than faked.
   *
   * The platform page put `DashboardLayout`'s `ProjectSelector` in its header.
   * That component is the application shell away — the organization graph, the
   * router and the shell's own scope memory — and nothing mounts
   * `DashboardLayout` above a screen served from `apps/ui` until the chrome
   * layout route exists. `null` is the true answer, and the audit trail loses
   * least by it of any page that has recorded this gap: its own Project filter
   * already narrows the table to any project in the organization.
   */
  projectSwitcher(): ReactNode | null {
    return this.readings.projectSwitcher;
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  download(file: OrganizationDownload): void {
    this.actions.download(file);
  }

  failed(failure: OrganizationFailureNotice): void {
    this.actions.failed(failure);
  }
}
