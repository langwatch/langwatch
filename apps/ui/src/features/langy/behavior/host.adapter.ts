/**
 * The Langy package's host port, answered from this application.
 *
 * `@langwatch/langy-web` declares what the dock needs — the project in scope,
 * the team it sits on, the organization, the reader, their grants, the release
 * flags, the address, where a plan is managed, the two notices — as one
 * abstract class it can define without importing anything of ours. This is the
 * other half: a plain adapter over the capabilities the application shell
 * already resolves.
 *
 * `featureFlag` passes the TRI-STATE through rather than the fail-closed
 * reading. The dock reads three flags and each one gates a capability inside an
 * already-open panel; flashing one off while the answer is in flight is worse
 * than waiting, which is the same argument the page guard makes for itself.
 *
 * `planManagementUrl` is the one method no earlier family asked for. It is a
 * fact about the DEPLOYMENT — a SaaS install sends a reader to a subscription,
 * a self-hosted one to a license — and reading the deployment's shape is
 * exactly what ADR-101 says a reusable package may not do.
 */

import {
  LangyHostPort,
  type LangyFailureNotice,
  type LangyHostOrganization,
  type LangyHostOrganizationRole,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyHostUser,
  type LangyRouteReading,
  type LangySuccessNotice,
} from "@langwatch/langy-web/screens/langy-layout";

export type LangyHostReadings = {
  project: LangyHostProject | undefined;
  organization: LangyHostOrganization | undefined;
  team: LangyHostTeam | undefined;
  organizationRole: LangyHostOrganizationRole;
  currentUser: LangyHostUser | undefined;
  hasPermission: (permission: string) => boolean;
  featureFlag: (flag: string) => boolean | undefined;
  isLoading: boolean;
  route: LangyRouteReading;
  planManagementUrl: string | undefined;
};

export type LangyHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  succeeded: (notice: LangySuccessNotice) => void;
  failed: (failure: LangyFailureNotice) => void;
};

export class UiLangyHost extends LangyHostPort {
  static create(readings: LangyHostReadings, actions: LangyHostActions): UiLangyHost {
    return new UiLangyHost(readings, actions);
  }

  private constructor(
    private readonly readings: LangyHostReadings,
    private readonly actions: LangyHostActions,
  ) {
    super();
  }

  project(): LangyHostProject | undefined {
    return this.readings.project;
  }

  organization(): LangyHostOrganization | undefined {
    return this.readings.organization;
  }

  team(): LangyHostTeam | undefined {
    return this.readings.team;
  }

  organizationRole(): LangyHostOrganizationRole {
    return this.readings.organizationRole;
  }

  currentUser(): LangyHostUser | undefined {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  featureFlag(flag: string): boolean | undefined {
    return this.readings.featureFlag(flag);
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  route(): LangyRouteReading {
    return this.readings.route;
  }

  planManagementUrl(): string | undefined {
    return this.readings.planManagementUrl;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  navigate(to: string, options?: { replace?: boolean }): void {
    this.actions.navigate(to, options);
  }

  succeeded(notice: LangySuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: LangyFailureNotice): void {
    this.actions.failed(failure);
  }
}
