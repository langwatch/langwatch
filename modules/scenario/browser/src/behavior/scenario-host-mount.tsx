/**
 * Scenario's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import { useUiCapabilities } from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  ScenarioHostApi,
  ScenarioHostProvider,
  type ScenarioFailureNotice,
  type ScenarioHostOrganization,
  type ScenarioHostOrganizationRole,
  type ScenarioHostProject,
  type ScenarioHostTeam,
  type ScenarioHostUser,
  type ScenarioRouteReading,
  type ScenarioSuccessNotice,
} from "../model/scenario-host.ts";

type ScenarioHostReadings = {
  readonly project: ScenarioHostProject | undefined;
  readonly organization: ScenarioHostOrganization | undefined;
  readonly team: ScenarioHostTeam | undefined;
  readonly currentUser: ScenarioHostUser | undefined;
  readonly isLoading: boolean;
};

type ScenarioHostActions = {
  readonly hasPermission: (permission: string) => boolean;
  readonly route: () => ScenarioRouteReading;
  readonly setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
  readonly succeeded: (notice: ScenarioSuccessNotice) => void;
  readonly failed: (failure: ScenarioFailureNotice) => void;
};

class CapabilityScenarioHost extends ScenarioHostApi {
  constructor(
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

  /**
   * No capability carries the reader's standing in the organization yet. The
   * port admits absence, so absence is what it is told — never a guessed role.
   */
  organizationRole(): ScenarioHostOrganizationRole {
    return void 0;
  }

  currentUser(): ScenarioHostUser | undefined {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  route(): ScenarioRouteReading {
    return this.actions.route();
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

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function ScenarioHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const { organization, team, project, status } = session.snapshot().scope;
  const actor = session.currentUser();

  // Primitive dependencies only, so the host stays the SAME object across
  // renders carrying the same reading: `lazy()` resolved this mount once, and
  // a fresh object every render would remount the whole tree under it.
  const projectId = project?.id;
  const projectName = project?.name;
  const projectSlug = project?.slug;
  const organizationId = organization?.id;
  const organizationName = organization?.name;
  const teamId = team?.id;
  const teamName = team?.name;
  const actorId = actor?.id;
  const actorName = actor?.name;
  const actorEmail = actor?.email;
  const actorImage = actor?.image;

  const host = useMemo(
    () =>
      new CapabilityScenarioHost(
        {
          project:
            projectId === void 0
              ? void 0
              : { id: projectId, slug: projectSlug ?? "", name: projectName ?? "" },
          organization:
            organizationId === void 0
              ? void 0
              : { id: organizationId, ...(organizationName ? { name: organizationName } : {}) },
          team:
            teamId === void 0 ? void 0 : { id: teamId, ...(teamName ? { name: teamName } : {}) },
          currentUser:
            actorId === void 0
              ? void 0
              : { id: actorId, name: actorName, email: actorEmail, image: actorImage },
          isLoading: status === "loading",
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          route: () => {
            const reading = route.reading();
            return {
              params: reading.params,
              query: reading.query,
              pathname: reading.pathname ?? "",
            };
          },
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to, options) =>
            options?.replace === true ? navigation.replace(to) : navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [
      projectId,
      projectName,
      projectSlug,
      organizationId,
      organizationName,
      teamId,
      teamName,
      actorId,
      actorName,
      actorEmail,
      actorImage,
      status,
      session,
      navigation,
      route,
      feedback,
    ],
  );

  return <ScenarioHostProvider value={host}>{children}</ScenarioHostProvider>;
}
