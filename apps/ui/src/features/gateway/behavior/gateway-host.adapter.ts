/**
 * The gateway package's host port, answered from this application.
 *
 * `@langwatch/gateway-web` declares what its screens need — the scope, the
 * organization graph, the project and team the reader is standing in, who is
 * signed in, permissions, flags, the plan, the deployment, the address and the
 * two feedback notices — as one abstract class it can define without importing
 * anything of ours. This is the other half: a plain adapter over the
 * capabilities the application shell already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import type {
  GatewayActor,
  GatewayDeployment,
  GatewayFailureNotice,
  GatewayOrganization,
  GatewayPlan,
  GatewayProject,
  GatewayRouteReading,
  GatewayScope,
  GatewaySuccessNotice,
  GatewayTeam,
} from "@langwatch/gateway-web/screens/gateway";
import { GatewayHostPort } from "@langwatch/gateway-web/screens/gateway";

export type GatewayHostReadings = {
  scope: GatewayScope;
  organizations: readonly GatewayOrganization[];
  currentUser: GatewayActor | null;
  plan: GatewayPlan;
  deployment: GatewayDeployment;
  route: GatewayRouteReading;
};

export type GatewayHostActions = {
  hasPermission: (permission: string) => boolean;
  isFeatureEnabled: (flag: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: GatewaySuccessNotice) => void;
  failed: (failure: GatewayFailureNotice) => void;
};

export class UiGatewayHost extends GatewayHostPort {
  static create(readings: GatewayHostReadings, actions: GatewayHostActions): UiGatewayHost {
    return new UiGatewayHost(readings, actions);
  }

  private constructor(
    private readonly readings: GatewayHostReadings,
    private readonly actions: GatewayHostActions,
  ) {
    super();
  }

  scope(): GatewayScope {
    return this.readings.scope;
  }

  organizations(): readonly GatewayOrganization[] {
    return this.readings.organizations;
  }

  organization(): GatewayOrganization | undefined {
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
  project(): GatewayProject | undefined {
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

  team(): GatewayTeam | undefined {
    const { projectId } = this.readings.scope;
    if (!projectId) return void 0;
    for (const organization of this.readings.organizations) {
      const team = organization.teams.find((candidate) =>
        candidate.projects.some((project) => project.id === projectId),
      );
      if (team) return team;
    }
    return void 0;
  }

  currentUser(): GatewayActor | null {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  isFeatureEnabled(flag: string): boolean {
    return this.actions.isFeatureEnabled(flag);
  }

  plan(): GatewayPlan {
    return this.readings.plan;
  }

  deployment(): GatewayDeployment {
    return this.readings.deployment;
  }

  route(): GatewayRouteReading {
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

  succeeded(notice: GatewaySuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: GatewayFailureNotice): void {
    this.actions.failed(failure);
  }
}
