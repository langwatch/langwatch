/**
 * The automations package's host port, answered from this application.
 *
 * `@langwatch/automation-web` declares what its screen, its two editors and its
 * five delivery providers need — the scope, the organization, the team and
 * project the reader is standing in, permissions, flags (both the fail-closed
 * reading and the tri-state one), this deployment's own address, the two
 * feedback notices and one line of copy for a failure — as one abstract class
 * it can define without importing anything of ours. This is the other half: a
 * plain adapter over the capabilities the application shell already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import type {
  AutomationDrawer,
  AutomationFailureNotice,
  AutomationOrganization,
  AutomationProject,
  AutomationRouteReading,
  AutomationScope,
  AutomationSuccessNotice,
  AutomationTeam,
} from "@langwatch/automation-web/screens/automations";
import { AutomationHostPort } from "@langwatch/automation-web/screens/automations";

/** The key `openDrawer` writes the drawer's name under. */
export const DRAWER_OPEN_PARAM = "drawer.open";

export type AutomationHostReadings = {
  scope: AutomationScope;
  organization: AutomationOrganization | undefined;
  team: AutomationTeam | undefined;
  project: AutomationProject | undefined;
  appBaseUrl: string;
  route: AutomationRouteReading;
};

export type AutomationHostActions = {
  hasPermission: (permission: string) => boolean;
  featureFlag: (flag: string) => boolean | undefined;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: AutomationSuccessNotice) => void;
  failed: (failure: AutomationFailureNotice) => void;
  describeFailure: (failure: AutomationFailureNotice) => string;
};

export class UiAutomationHost extends AutomationHostPort {
  static create(
    readings: AutomationHostReadings,
    actions: AutomationHostActions,
  ): UiAutomationHost {
    return new UiAutomationHost(readings, actions);
  }

  private constructor(
    private readonly readings: AutomationHostReadings,
    private readonly actions: AutomationHostActions,
  ) {
    super();
  }

  scope(): AutomationScope {
    return this.readings.scope;
  }

  organization(): AutomationOrganization | undefined {
    return this.readings.organization;
  }

  team(): AutomationTeam | undefined {
    return this.readings.team;
  }

  project(): AutomationProject | undefined {
    return this.readings.project;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  /** Fails closed: an answer that has not arrived reads as no. */
  isFeatureEnabled(flag: string): boolean {
    return this.actions.featureFlag(flag) === true;
  }

  featureFlag(flag: string): boolean | undefined {
    return this.actions.featureFlag(flag);
  }

  appBaseUrl(): string {
    return this.readings.appBaseUrl;
  }

  route(): AutomationRouteReading {
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

  openDrawer({
    drawer,
    params = {},
  }: {
    drawer: AutomationDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    // Every other `drawer.*` key is dropped, exactly as `openDrawer` does:
    // leaving a previous drawer's parameters behind is what makes the editor
    // open on the automation the reader was only looking at.
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.readings.route.query)) {
      if (!key.startsWith("drawer.")) next[key] = value;
    }
    next[DRAWER_OPEN_PARAM] = drawer;
    for (const [name, value] of Object.entries(params)) {
      if (value !== void 0) next[`drawer.${name}`] = value;
    }
    this.actions.setQuery(next);
  }

  succeeded(notice: AutomationSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: AutomationFailureNotice): void {
    this.actions.failed(failure);
  }

  describeFailure(failure: AutomationFailureNotice): string {
    return this.actions.describeFailure(failure);
  }
}
