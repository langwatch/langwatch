/**
 * The personal-workspace package's host port, answered from this application.
 *
 * `@langwatch/user-web` declares what its screens need — the scope, the
 * organization and project the reader is standing in, who is signed in, their
 * organization role, permissions, flags, the deployment, the address, a session
 * refresh and the two feedback notices — as one abstract class it can define
 * without importing anything of ours. This is the other half: a plain adapter
 * over the capabilities the application shell already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import type {
  PersonalActor,
  PersonalDeployment,
  PersonalFailureNotice,
  PersonalOrganization,
  PersonalOrganizationRole,
  PersonalProject,
  PersonalRouteReading,
  PersonalScope,
  PersonalSuccessNotice,
} from "@langwatch/user-web/screens/personal-workspace";
import { PersonalWorkspaceHostPort } from "@langwatch/user-web/screens/personal-workspace";

export type PersonalWorkspaceHostReadings = {
  scope: PersonalScope;
  organizations: readonly PersonalOrganization[];
  organizationRole: PersonalOrganizationRole;
  isScopeResolved: boolean;
  currentUser: PersonalActor | null;
  deployment: PersonalDeployment;
  route: PersonalRouteReading;
};

export type PersonalWorkspaceHostActions = {
  hasPermission: (permission: string) => boolean;
  isFeatureEnabled: (flag: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  refreshSession: () => Promise<void>;
  succeeded: (notice: PersonalSuccessNotice) => void;
  failed: (failure: PersonalFailureNotice) => void;
};

export class UiPersonalWorkspaceHost extends PersonalWorkspaceHostPort {
  static create(
    readings: PersonalWorkspaceHostReadings,
    actions: PersonalWorkspaceHostActions,
  ): UiPersonalWorkspaceHost {
    return new UiPersonalWorkspaceHost(readings, actions);
  }

  private constructor(
    private readonly readings: PersonalWorkspaceHostReadings,
    private readonly actions: PersonalWorkspaceHostActions,
  ) {
    super();
  }

  scope(): PersonalScope {
    return this.readings.scope;
  }

  organization(): PersonalOrganization | undefined {
    const { organizationId } = this.readings.scope;
    if (!organizationId) return void 0;
    return this.readings.organizations.find((candidate) => candidate.id === organizationId);
  }

  /**
   * The project the address is about, found in the graph rather than fetched.
   *
   * Every organization the reader can reach is already in hand, so the project
   * behind the active scope is a lookup; a second read would be a second
   * request for a row that is on the page.
   */
  project(): PersonalProject | undefined {
    const { projectId } = this.readings.scope;
    if (!projectId) return void 0;
    for (const organization of this.readings.organizations) {
      for (const team of organization.teams) {
        const project = team.projects.find((candidate) => candidate.id === projectId);
        if (project) return project;
      }
    }
    return void 0;
  }

  isScopeResolved(): boolean {
    return this.readings.isScopeResolved;
  }

  currentUser(): PersonalActor | null {
    return this.readings.currentUser;
  }

  organizationRole(): PersonalOrganizationRole {
    return this.readings.organizationRole;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  isFeatureEnabled(flag: string): boolean {
    return this.actions.isFeatureEnabled(flag);
  }

  deployment(): PersonalDeployment {
    return this.readings.deployment;
  }

  route(): PersonalRouteReading {
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

  refreshSession(): Promise<void> {
    return this.actions.refreshSession();
  }

  succeeded(notice: PersonalSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: PersonalFailureNotice): void {
    this.actions.failed(failure);
  }
}
