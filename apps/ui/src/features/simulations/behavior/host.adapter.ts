/**
 * The scenario package's host port, answered from this application.
 *
 * `@langwatch/scenario-web` declares what the run board, the Scenario Library
 * and Agent Testing need — the project in scope, the team it sits on, the
 * organization, the reader, their grants, the address, the two notices — as one
 * abstract class it can define without importing anything of ours. This is the
 * other half: a plain adapter over the capabilities the application shell
 * already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * `setQuery` MERGES, the way the trace family's does and for the same reason:
 * the suite rail, the batch highlight, the tab follower and the run drawer each
 * write their own keys, from different components, in the same tick, and a
 * replacing write would drop whichever half did not do the writing.
 */

import {
  ScenarioHostPort,
  type ScenarioFailureNotice,
  type ScenarioHostOrganization,
  type ScenarioHostOrganizationRole,
  type ScenarioHostProject,
  type ScenarioHostTeam,
  type ScenarioHostUser,
  type ScenarioRouteReading,
  type ScenarioSuccessNotice,
} from "@langwatch/scenario-web/screens/simulations";

/** The grant all three platform pages carried, unchanged. */
export const SIMULATIONS_PAGE_PERMISSION = "scenarios:view";

/** The release flag that gated the Agent Testing address, unchanged. */
export const AGENT_TESTING_RELEASE_FLAG = "release_ui_agent_testing_v2_enabled";

export type ScenarioHostReadings = {
  project: ScenarioHostProject | undefined;
  organization: ScenarioHostOrganization | undefined;
  team: ScenarioHostTeam | undefined;
  organizationRole: ScenarioHostOrganizationRole;
  currentUser: ScenarioHostUser | undefined;
  hasPermission: (permission: string) => boolean;
  isLoading: boolean;
  route: ScenarioRouteReading;
};

export type ScenarioHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  succeeded: (notice: ScenarioSuccessNotice) => void;
  failed: (failure: ScenarioFailureNotice) => void;
};

export class UiScenarioHost extends ScenarioHostPort {
  static create(readings: ScenarioHostReadings, actions: ScenarioHostActions): UiScenarioHost {
    return new UiScenarioHost(readings, actions);
  }

  private constructor(
    private readonly readings: ScenarioHostReadings,
    private readonly actions: ScenarioHostActions,
  ) {
    super();
  }

  project(): ScenarioHostProject | undefined {
    return this.readings.project;
  }

  organization(): ScenarioHostOrganization | undefined {
    return this.readings.organization;
  }

  team(): ScenarioHostTeam | undefined {
    return this.readings.team;
  }

  organizationRole(): ScenarioHostOrganizationRole {
    return this.readings.organizationRole;
  }

  currentUser(): ScenarioHostUser | undefined {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  route(): ScenarioRouteReading {
    return this.readings.route;
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

  succeeded(notice: ScenarioSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: ScenarioFailureNotice): void {
    this.actions.failed(failure);
  }
}
