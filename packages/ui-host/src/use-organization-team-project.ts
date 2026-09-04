/**
 * The scope reading every feature-web package makes, answered from ONE place.
 *
 * Eleven packages carried their own `useOrganizationTeamProject`, each bound to
 * its own feature host provider. That is what broke D20: a component owned by
 * one family and rendered by another threw, because only the owning family's
 * routes mount its provider. A reading that any screen may make cannot be
 * gated on which screen is mounted, so it is asked of a port declared here and
 * published by whatever the application mounts above the route.
 *
 * ABSENT IS A READING, NOT A CRASH. With no scope host above it the hook
 * answers "nothing in scope, no grants held" rather than throwing. That is the
 * difference between a cross-feature component that renders without a preview
 * and one that takes the page down, and it is the whole point of moving the
 * reading here. `isResolved` is how a caller tells that apart from a scope
 * that is still arriving.
 */

import { createContext, useContext, useMemo } from "react";

/** The project the reader is standing in, as every family reads it. */
export type UiHostProject = { id: string; name: string; slug: string };

export type UiHostOrganization = { id: string; name?: string };

export type UiHostTeam = { id: string; name?: string };

/**
 * The one thing a scope reading is asked of.
 *
 * Grants answer SYNCHRONOUSLY AND FAIL CLOSED: a permission that flickers open
 * while the answer is in flight is a permission that leaked.
 */
export abstract class UiScopeHostPort {
  abstract project(): UiHostProject | undefined;

  abstract organization(): UiHostOrganization | undefined;

  abstract team(): UiHostTeam | undefined;

  /** The reader's role in the organization, or undefined before it resolves. */
  abstract organizationRole(): string | undefined;

  abstract hasPermission(permission: string): boolean;

  /**
   * The same question asked of the ORGANIZATION rather than of the page's scope.
   *
   * A grant held on the organization but narrowed by a project binding is a
   * different answer, and the plan and team controls read that one.
   */
  abstract hasOrganizationPermission(permission: string): boolean;

  abstract isDemoProject(): boolean;

  /** Whether the scope answer is still arriving. */
  abstract isLoading(): boolean;
}

/** The readings a host publishes, without it having to declare a class. */
export type UiScopeHostReadings = {
  project: () => UiHostProject | undefined;
  organization: () => UiHostOrganization | undefined;
  team: () => UiHostTeam | undefined;
  organizationRole?: () => string | undefined;
  hasPermission: (permission: string) => boolean;
  hasOrganizationPermission?: (permission: string) => boolean;
  isDemoProject?: () => boolean;
  isLoading?: () => boolean;
};

class DerivedUiScopeHost extends UiScopeHostPort {
  constructor(private readonly readings: UiScopeHostReadings) {
    super();
  }

  project = () => this.readings.project();
  organization = () => this.readings.organization();
  team = () => this.readings.team();
  organizationRole = () => this.readings.organizationRole?.();
  hasPermission = (permission: string) => this.readings.hasPermission(permission);
  hasOrganizationPermission = (permission: string) =>
    (this.readings.hasOrganizationPermission ?? this.readings.hasPermission)(permission);
  isDemoProject = () => this.readings.isDemoProject?.() ?? false;
  isLoading = () => this.readings.isLoading?.() ?? false;
}

/**
 * Publishes a feature host's own scope readings as the canonical one.
 *
 * A family that already resolved the scope for its own port answers this from
 * the same readings rather than from a second source of truth.
 */
export function createUiScopeHost(readings: UiScopeHostReadings): UiScopeHostPort {
  return new DerivedUiScopeHost(readings);
}

const UiScopeHostContext = createContext<UiScopeHostPort | undefined>(void 0);

export const UiScopeHostProvider = UiScopeHostContext.Provider;

/** The scope host above this screen, or undefined where none is mounted. */
export function useOptionalUiScopeHost(): UiScopeHostPort | undefined {
  return useContext(UiScopeHostContext);
}

export type UiScopeReading = {
  project: UiHostProject | undefined;
  /** The platform hook published it flat as well, and call sites read it that way. */
  projectId: string | undefined;
  organization: UiHostOrganization | undefined;
  team: UiHostTeam | undefined;
  organizationRole: string | undefined;
  isDemoProject: boolean;
  hasPermission: (permission: string) => boolean;
  hasOrgPermission: (permission: string) => boolean;
  isLoading: boolean;
  isRefetching: boolean;
  /** False when no scope host is mounted at all, which is not the same as loading. */
  isResolved: boolean;
};

const NO_SCOPE: UiScopeReading = {
  project: void 0,
  projectId: void 0,
  organization: void 0,
  team: void 0,
  organizationRole: void 0,
  isDemoProject: false,
  hasPermission: () => false,
  hasOrgPermission: () => false,
  isLoading: false,
  isRefetching: false,
  isResolved: false,
};

/**
 * The scope this page is about.
 *
 * The options object is accepted and ignored. The application hook this
 * replaces also redirected a reader with no project to onboarding; landing
 * policy belongs to whatever serves the address, and a screen that navigates
 * on a scope it could not resolve is how a signed-in reader gets bounced out
 * of the page they asked for.
 */
export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}): UiScopeReading {
  const host = useOptionalUiScopeHost();
  return useMemo(() => {
    if (!host) return NO_SCOPE;
    const project = host.project();
    return {
      project,
      projectId: project?.id,
      organization: host.organization(),
      team: host.team(),
      organizationRole: host.organizationRole(),
      isDemoProject: host.isDemoProject(),
      hasPermission: (permission: string) => host.hasPermission(permission),
      hasOrgPermission: (permission: string) => host.hasOrganizationPermission(permission),
      isLoading: host.isLoading(),
      isRefetching: false,
      isResolved: true,
    };
  }, [host]);
}
