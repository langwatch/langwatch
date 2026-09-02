/**
 * The project home's host port, answered from this application.
 *
 * `@langwatch/project-web` declares what the home needs — the reader, the
 * project and organization in scope, one grant question, one rollout question,
 * the assistant's two gates, the deployment, the motion preference and the one
 * navigation — as an abstract class it can define without importing anything of
 * ours. This is the other half: a plain adapter over what has already been read.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import {
  ProjectHomeHostPort,
  type ProjectHomeDeployment,
  type ProjectHomeFlagReading,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "@langwatch/project-web/screens/home";

export type HomeHostReadings = {
  project: ProjectHomeProject | undefined;
  organization: ProjectHomeOrganization | undefined;
  currentUser: ProjectHomeUser | undefined;
  isLoading: boolean;
  langyVisibility: ProjectHomeLangyVisibility;
  canAskLangy: boolean;
  deployment: ProjectHomeDeployment;
  reducedMotion: boolean;
};

export type HomeHostActions = {
  hasPermission: (permission: string) => boolean;
  featureFlag: (flag: string) => ProjectHomeFlagReading;
  navigate: (to: string) => void;
};

export class UiProjectHomeHost extends ProjectHomeHostPort {
  static create(readings: HomeHostReadings, actions: HomeHostActions): UiProjectHomeHost {
    return new UiProjectHomeHost(readings, actions);
  }

  private constructor(
    private readonly readings: HomeHostReadings,
    private readonly actions: HomeHostActions,
  ) {
    super();
  }

  project(): ProjectHomeProject | undefined {
    return this.readings.project;
  }

  organization(): ProjectHomeOrganization | undefined {
    return this.readings.organization;
  }

  currentUser(): ProjectHomeUser | undefined {
    return this.readings.currentUser;
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  /**
   * The tri-state the session capability keeps, narrowed to the two fields the
   * home reads. `isLoading` is what stops the page picking a composition
   * against a rollout still in flight.
   */
  featureFlag(flag: string): ProjectHomeFlagReading {
    return this.actions.featureFlag(flag);
  }

  langyVisibility(): ProjectHomeLangyVisibility {
    return this.readings.langyVisibility;
  }

  canAskLangy(): boolean {
    return this.readings.canAskLangy;
  }

  deployment(): ProjectHomeDeployment {
    return this.readings.deployment;
  }

  reducedMotion(): boolean {
    return this.readings.reducedMotion;
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }
}
