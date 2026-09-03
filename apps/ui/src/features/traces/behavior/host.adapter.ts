/**
 * The trace package's host port, answered from this application.
 *
 * `@langwatch/trace-web` declares what the Trace Explorer and the shared-trace
 * page need — the project in scope, the team it sits on, the organization, the
 * reader, their grants, the address, the two notices — as one abstract class it
 * can define without importing anything of ours. This is the other half: a
 * plain adapter over the capabilities the application shell already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * `setQuery` MERGES, and that is the one difference from every earlier family.
 * `UiRoutePort.setQuery` replaces the whole query, which is right for a screen
 * that owns its address; the explorer does not own its address alone — the
 * filter rail, the time range, the lens, the drawer and the span selection each
 * write their own keys, from different components, in the same tick. So the
 * merge happens here, over the reading, and a caller removes a key by writing
 * `undefined` exactly as it always did.
 */

import type {
  TraceFailureNotice,
  TraceHostOrganization,
  TraceHostOrganizationRole,
  TraceHostProject,
  TraceHostTeam,
  TraceHostUser,
  TraceRouteReading,
  TraceSuccessNotice,
} from "@langwatch/trace-web/screens/traces";
import { TraceHostPort } from "@langwatch/trace-web/screens/traces";

/** The grant the platform page carried, unchanged. */
export const TRACES_PAGE_PERMISSION = "traces:view";

export type TraceHostReadings = {
  project: TraceHostProject | undefined;
  organization: TraceHostOrganization | undefined;
  team: TraceHostTeam | undefined;
  organizationRole: TraceHostOrganizationRole;
  currentUser: TraceHostUser | undefined;
  hasPermission: (permission: string) => boolean;
  isLoading: boolean;
  route: TraceRouteReading;
};

export type TraceHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  succeeded: (notice: TraceSuccessNotice) => void;
  failed: (failure: TraceFailureNotice) => void;
};

export class UiTraceHost extends TraceHostPort {
  static create(readings: TraceHostReadings, actions: TraceHostActions): UiTraceHost {
    return new UiTraceHost(readings, actions);
  }

  private constructor(
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

  organizationRole(): TraceHostOrganizationRole {
    return this.readings.organizationRole;
  }

  currentUser(): TraceHostUser | undefined {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  route(): TraceRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery({ ...this.readings.route.query, ...next }, options);
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
}
