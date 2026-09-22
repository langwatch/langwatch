/**
 * Trace's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import { useUiCapabilities } from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  TraceHostApi,
  TraceHostProvider,
  type TraceFailureNotice,
  type TraceHostOrganization,
  type TraceHostOrganizationRole,
  type TraceHostProject,
  type TraceHostTeam,
  type TraceHostUser,
  type TraceRouteReading,
  type TraceSuccessNotice,
} from "./trace-host.ts";

type TraceHostReadings = {
  readonly project: TraceHostProject | undefined;
  readonly organization: TraceHostOrganization | undefined;
  readonly team: TraceHostTeam | undefined;
  readonly currentUser: TraceHostUser | undefined;
  readonly isLoading: boolean;
};

type TraceHostActions = {
  readonly hasPermission: (permission: string) => boolean;
  readonly route: () => TraceRouteReading;
  readonly setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
  readonly succeeded: (notice: TraceSuccessNotice) => void;
  readonly failed: (failure: TraceFailureNotice) => void;
};

class CapabilityTraceHost extends TraceHostApi {
  constructor(
    private readonly readings: TraceHostReadings,
    private readonly actions: TraceHostActions,
  ) {
    super();
  }

  project(): TraceHostProject | undefined {
    return this.readings.project;
  }

  organization(): TraceHostOrganization | undefined {
    return this.readings.organization;
  }

  team(): TraceHostTeam | undefined {
    return this.readings.team;
  }

  /**
   * No capability carries the reader's standing in the organization yet. The
   * port admits absence, so absence is what it is told — never a guessed role.
   */
  organizationRole(): TraceHostOrganizationRole {
    return void 0;
  }

  currentUser(): TraceHostUser | undefined {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  route(): TraceRouteReading {
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

  succeeded(notice: TraceSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: TraceFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * No `@langwatch/browser-host` capability carries the agent's page
   * registry, so the port is told absence rather than a guess: a composition
   * that installs Langy answers this from Langy's published capability.
   */
  registerLangyActions(): () => void {
    return () => void 0;
  }

  /** Likewise the ask: no capability carries the agent's composer yet. */
  askLangy(): void {
    // Nothing to hand it to.
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function TraceHostMount({ children }: { children?: ReactNode }) {
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
      new CapabilityTraceHost(
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

  return <TraceHostProvider value={host}>{children}</TraceHostProvider>;
}
