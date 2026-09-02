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
  type OrganizationActor,
  type OrganizationDownload,
  type OrganizationFailureNotice,
  type OrganizationProjectReading,
  type OrganizationReading,
  type OrganizationRouteReading,
  type OrganizationScope,
  type OrganizationSuccessNotice,
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

/**
 * The grants the four settings keys carry, one for one with the platform pages.
 *
 * They are NOT all the same, and the asymmetry is carried rather than tidied:
 * members, teams and groups were `organization:manage`, and the team detail
 * page was `team:view` — a reader who may see a team may open it, and every
 * write on it states its own policy. Inventing a guard is a change to who can
 * reach an address, and a page move does not own that decision.
 */
export const MEMBERS_PAGE_PERMISSION = "organization:manage";
export const TEAMS_PAGE_PERMISSION = "organization:manage";
export const GROUPS_PAGE_PERMISSION = "organization:manage";
export const TEAM_DETAIL_PAGE_PERMISSION = "team:view";

export type OrganizationHostReadings = {
  scope: OrganizationScope;
  organization: OrganizationReading | undefined;
  activeProject: OrganizationProjectReading | undefined;
  currentUser: OrganizationActor | undefined;
  isEnterprise: boolean;
  isPlanLoading: boolean;
  hasEmailProvider: boolean;
  route: OrganizationRouteReading;
  projectSwitcher: ReactNode | null;
};

export type OrganizationHostActions = {
  hasPermission: (permission: string) => boolean;
  hasOrganizationPermission: (permission: string) => boolean;
  isFeatureEnabled: (flag: string) => boolean;
  openOverlay: (name: string, props?: Record<string, unknown>) => void;
  closeOverlay: () => void;
  succeeded: (notice: OrganizationSuccessNotice) => void;
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

  hasOrganizationPermission(permission: string): boolean {
    return this.actions.hasOrganizationPermission(permission);
  }

  currentUser(): OrganizationActor | undefined {
    return this.readings.currentUser;
  }

  activeProject(): OrganizationProjectReading | undefined {
    return this.readings.activeProject;
  }

  isEnterprise(): boolean {
    return this.readings.isEnterprise;
  }

  isPlanLoading(): boolean {
    return this.readings.isPlanLoading;
  }

  hasEmailProvider(): boolean {
    return this.readings.hasEmailProvider;
  }

  isFeatureEnabled(flag: string): boolean {
    return this.actions.isFeatureEnabled(flag);
  }

  openOverlay(name: string, props?: Record<string, unknown>): void {
    this.actions.openOverlay(name, props);
  }

  closeOverlay(): void {
    this.actions.closeOverlay();
  }

  succeeded(notice: OrganizationSuccessNotice): void {
    this.actions.succeeded(notice);
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
   * THE RECORDED GAP, NOW CLOSED.
   *
   * The platform page put `DashboardLayout`'s `ProjectSelector` in its header,
   * and while nothing mounted `DashboardLayout` above a screen served from
   * `apps/ui` this had to answer `null`. The chrome layout route mounts the
   * navigation host above every settings address now, so the answer is the real
   * control — `@langwatch/navigation-web`'s switcher, offering the teams this
   * reader may open and landing on the address they are already on.
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
