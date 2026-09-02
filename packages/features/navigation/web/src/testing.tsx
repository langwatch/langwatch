/**
 * What a test mounts this package's screens inside.
 *
 * One stub host, built from a partial reading, so a suite states only the facts
 * its scenario turns on and gets fail-closed answers for the rest. The same
 * shape every other feature-web package's `testing` entry keeps.
 */

import type { ReactNode } from "react";
import {
  NavigationHostPort,
  NavigationHostProvider,
  type NavigationFlagReading,
  type NavigationOrganization,
  type NavigationProject,
  type NavigationTeam,
} from "./model/navigation-host";
import type { LastVisitedHomeKind } from "./model/resolve-home-destination";

export type StubNavigationReadings = {
  organizations?: NavigationOrganization[];
  organization?: NavigationOrganization;
  project?: NavigationProject;
  openableTeams?: readonly NavigationTeam[];
  isLoading?: boolean;
  currentUserId?: string;
  organizationRole?: string;
  rememberedProjectSlug?: string;
  lastVisitedHomeKind?: LastVisitedHomeKind;
  permissions?: readonly string[];
  flags?: Readonly<Record<string, NavigationFlagReading>>;
  waiting?: ReactNode;
};

export type StubNavigationActions = {
  replace?: (to: string) => void;
  navigate?: (to: string) => void;
};

export class StubNavigationHost extends NavigationHostPort {
  static create(
    readings: StubNavigationReadings = {},
    actions: StubNavigationActions = {},
  ): StubNavigationHost {
    return new StubNavigationHost(readings, actions);
  }

  private constructor(
    private readonly readings: StubNavigationReadings,
    private readonly actions: StubNavigationActions,
  ) {
    super();
  }

  organizations(): NavigationOrganization[] {
    return this.readings.organizations ?? [];
  }

  organization(): NavigationOrganization | undefined {
    return this.readings.organization;
  }

  project(): NavigationProject | undefined {
    return this.readings.project;
  }

  openableTeams(): readonly NavigationTeam[] {
    return this.readings.openableTeams ?? this.readings.organization?.teams ?? [];
  }

  isLoading(): boolean {
    return this.readings.isLoading ?? false;
  }

  currentUserId(): string | undefined {
    return this.readings.currentUserId;
  }

  organizationRole(): string | undefined {
    return this.readings.organizationRole;
  }

  rememberedProjectSlug(): string {
    return this.readings.rememberedProjectSlug ?? "";
  }

  lastVisitedHomeKind(): LastVisitedHomeKind {
    return this.readings.lastVisitedHomeKind ?? "";
  }

  hasPermission(permission: string): boolean {
    return (this.readings.permissions ?? []).includes(permission);
  }

  featureFlag(flag: string): NavigationFlagReading {
    return this.readings.flags?.[flag] ?? { enabled: false, isLoading: false };
  }

  waiting(): ReactNode {
    return this.readings.waiting ?? null;
  }

  replace(to: string): void {
    this.actions.replace?.(to);
  }

  navigate(to: string): void {
    this.actions.navigate?.(to);
  }
}

/** Mounts children under a stub host. */
export function WithStubNavigationHost({
  children,
  readings,
  actions,
}: {
  children: ReactNode;
  readings?: StubNavigationReadings;
  actions?: StubNavigationActions;
}) {
  return (
    <NavigationHostProvider value={StubNavigationHost.create(readings, actions)}>
      {children}
    </NavigationHostProvider>
  );
}
