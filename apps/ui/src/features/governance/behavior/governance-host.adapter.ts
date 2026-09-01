/**
 * The governance package's host port, answered from this application.
 *
 * `@langwatch/enterprise-governance-web` declares what its screens need — the
 * scope, the organization graph, permissions, flags, the plan, the address and
 * the two feedback notices — as one abstract class it can define without
 * importing anything of ours. This is the other half: a plain adapter over the
 * capabilities the application shell already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import type {
  GovernanceDeployment,
  GovernanceFailureNotice,
  GovernanceOrganization,
  GovernancePlan,
  GovernanceRouteReading,
  GovernanceScope,
  GovernanceSuccessNotice,
} from "@langwatch/enterprise-governance-web/screens/governance";
import { GovernanceHostPort } from "@langwatch/enterprise-governance-web/screens/governance";
export type GovernanceHostReadings = {
  scope: GovernanceScope;
  organizations: readonly GovernanceOrganization[];
  plan: GovernancePlan;
  deployment: GovernanceDeployment;
  route: GovernanceRouteReading;
};

export type GovernanceHostActions = {
  hasPermission: (permission: string) => boolean;
  isFeatureEnabled: (flag: string) => boolean;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: GovernanceSuccessNotice) => void;
  failed: (failure: GovernanceFailureNotice) => void;
};

export class UiGovernanceHost extends GovernanceHostPort {
  static create(
    readings: GovernanceHostReadings,
    actions: GovernanceHostActions,
  ): UiGovernanceHost {
    return new UiGovernanceHost(readings, actions);
  }

  private constructor(
    private readonly readings: GovernanceHostReadings,
    private readonly actions: GovernanceHostActions,
  ) {
    super();
  }

  scope(): GovernanceScope {
    return this.readings.scope;
  }

  organizations(): readonly GovernanceOrganization[] {
    return this.readings.organizations;
  }

  organization(): GovernanceOrganization | undefined {
    const { organizationId } = this.readings.scope;
    if (!organizationId) return void 0;
    return this.readings.organizations.find((candidate) => candidate.id === organizationId);
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  isFeatureEnabled(flag: string): boolean {
    return this.actions.isFeatureEnabled(flag);
  }

  plan(): GovernancePlan {
    return this.readings.plan;
  }

  deployment(): GovernanceDeployment {
    return this.readings.deployment;
  }

  route(): GovernanceRouteReading {
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

  succeeded(notice: GovernanceSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: GovernanceFailureNotice): void {
    this.actions.failed(failure);
  }
}
