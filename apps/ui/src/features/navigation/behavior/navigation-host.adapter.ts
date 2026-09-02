/**
 * The navigation package's host port, answered from this application.
 *
 * `@langwatch/navigation-web` declares what the landing redirect and the project
 * switcher need — the workspace graph, the signed-in reader, one grant check,
 * two feature flags, this device's scope memory, and the two navigations — as
 * one abstract class it can define without importing anything of ours. This is
 * the other half: a plain adapter over what the application shell has already
 * resolved.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in the
 * one component that mounts it.
 */

import {
  NavigationHostPort,
  type LastVisitedHomeKind,
  type NavigationFlagReading,
  type NavigationOrganization,
  type NavigationProject,
  type NavigationTeam,
} from "@langwatch/navigation-web/screens/landing";
import type { ReactNode } from "react";

export type NavigationHostReadings = {
  organizations: NavigationOrganization[];
  organization: NavigationOrganization | undefined;
  project: NavigationProject | undefined;
  openableTeams: readonly NavigationTeam[];
  isLoading: boolean;
  currentUserId: string | undefined;
  organizationRole: string | undefined;
  rememberedProjectSlug: string;
  lastVisitedHomeKind: LastVisitedHomeKind;
  waiting: ReactNode;
};

export type NavigationHostActions = {
  hasPermission: (permission: string) => boolean;
  featureFlag: (flag: string) => NavigationFlagReading;
  replace: (to: string) => void;
  navigate: (to: string) => void;
};

export class UiNavigationHost extends NavigationHostPort {
  static create(
    readings: NavigationHostReadings,
    actions: NavigationHostActions,
  ): UiNavigationHost {
    return new UiNavigationHost(readings, actions);
  }

  private constructor(
    private readonly readings: NavigationHostReadings,
    private readonly actions: NavigationHostActions,
  ) {
    super();
  }

  organizations(): NavigationOrganization[] {
    return this.readings.organizations;
  }

  organization(): NavigationOrganization | undefined {
    return this.readings.organization;
  }

  project(): NavigationProject | undefined {
    return this.readings.project;
  }

  openableTeams(): readonly NavigationTeam[] {
    return this.readings.openableTeams;
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  currentUserId(): string | undefined {
    return this.readings.currentUserId;
  }

  organizationRole(): string | undefined {
    return this.readings.organizationRole;
  }

  rememberedProjectSlug(): string {
    return this.readings.rememberedProjectSlug;
  }

  lastVisitedHomeKind(): LastVisitedHomeKind {
    return this.readings.lastVisitedHomeKind;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  /**
   * The tri-state the session capability keeps, narrowed to the two fields the
   * navigation package reads. `undefined` there means "not answered yet", which
   * is what stops a landing decision resolving against a flag still in flight.
   */
  featureFlag(flag: string): NavigationFlagReading {
    return this.actions.featureFlag(flag);
  }

  waiting(): ReactNode {
    return this.readings.waiting;
  }

  replace(to: string): void {
    this.actions.replace(to);
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }
}
