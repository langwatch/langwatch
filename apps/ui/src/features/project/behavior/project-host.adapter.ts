/**
 * The project package's host port, answered from this application.
 *
 * `@langwatch/project-web` declares what its screen needs — the organization
 * and the project it edits, two grants, a flag, the project switcher, the
 * overlay address and two notices — as one abstract class it can define without
 * importing anything of ours.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  ProjectHostPort,
  type ProjectFailureNotice,
  type ProjectHostOrganization,
  type ProjectHostProject,
  type ProjectSuccessNotice,
} from "@langwatch/project-web/screens/project";
import type { ReactNode } from "react";

/** The grant the platform page asked for, unchanged. */
export const PROJECT_SETTINGS_PAGE_PERMISSION = "organization:view";

export type ProjectHostReadings = {
  organization: ProjectHostOrganization | undefined;
  project: ProjectHostProject | undefined;
  isLiteMember: boolean;
  projectSwitcher: ReactNode | null;
};

export type ProjectHostActions = {
  hasPermission: (permission: string) => boolean;
  isFeatureEnabled: (flag: string) => boolean;
  openOverlay: (name: string, props?: Record<string, unknown>) => void;
  succeeded: (notice: ProjectSuccessNotice) => void;
  failed: (failure: ProjectFailureNotice) => void;
};

export class UiProjectHost extends ProjectHostPort {
  static create(readings: ProjectHostReadings, actions: ProjectHostActions): UiProjectHost {
    return new UiProjectHost(readings, actions);
  }

  private constructor(
    private readonly readings: ProjectHostReadings,
    private readonly actions: ProjectHostActions,
  ) {
    super();
  }

  organization(): ProjectHostOrganization | undefined {
    return this.readings.organization;
  }

  project(): ProjectHostProject | undefined {
    return this.readings.project;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  isLiteMember(): boolean {
    return this.readings.isLiteMember;
  }

  isFeatureEnabled(flag: string): boolean {
    return this.actions.isFeatureEnabled(flag);
  }

  projectSwitcher(): ReactNode | null {
    return this.readings.projectSwitcher;
  }

  openOverlay(name: string, props?: Record<string, unknown>): void {
    this.actions.openOverlay(name, props);
  }

  succeeded(notice: ProjectSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: ProjectFailureNotice): void {
    this.actions.failed(failure);
  }
}
