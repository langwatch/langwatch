/**
 * The annotations package's host port, answered from this application.
 *
 * `@langwatch/annotation-web` declares what its four views need — the project,
 * the reviewer, their grants and membership, whether the project in scope is
 * their own personal workspace, the address, and the two notices — as one
 * abstract class it can define without importing anything of ours. This is the
 * other half: a plain adapter over the capabilities the application shell
 * already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * THE CHROME GAP IS THIS SIDE'S, and it is recorded rather than papered over.
 * Two of the screens' actions write a `?drawer.open=…` address — viewing a
 * trace (`traceV2Details`) and handing rows to a dataset (`addDatasetRecord`).
 * Both drawers are registered in `platform/app` and mounted by
 * `DashboardPageBody`, which is application chrome a screen served from
 * `apps/ui` has nothing above it to supply. So on these screens the address
 * changes and nothing opens, exactly as the coding-agent, me and automations
 * families recorded for the same two registries. The address is still the right
 * thing to write: it is what makes both overlays come back for free when the
 * chrome layout route lands, and it is what a shared link already means.
 */

import type {
  AnnotationFailureNotice,
  AnnotationHostProject,
  AnnotationHostUser,
  AnnotationRouteReading,
  AnnotationSuccessNotice,
} from "@langwatch/annotation-web/screens/annotations";
import { AnnotationHostPort } from "@langwatch/annotation-web/screens/annotations";

/** The grant the platform inbox page asked for, unchanged. */
export const ANNOTATION_PAGE_PERMISSION = "annotations:view";

export type AnnotationHostReadings = {
  project: AnnotationHostProject | undefined;
  organizationId: string | undefined;
  currentUser: AnnotationHostUser | undefined;
  hasPermission: (permission: string) => boolean;
  isLiteMember: boolean;
  isOwnPersonalWorkspace: boolean;
  route: AnnotationRouteReading;
};

export type AnnotationHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: AnnotationSuccessNotice) => void;
  failed: (failure: AnnotationFailureNotice) => void;
};

export class UiAnnotationHost extends AnnotationHostPort {
  static create(
    readings: AnnotationHostReadings,
    actions: AnnotationHostActions,
  ): UiAnnotationHost {
    return new UiAnnotationHost(readings, actions);
  }

  private constructor(
    private readonly readings: AnnotationHostReadings,
    private readonly actions: AnnotationHostActions,
  ) {
    super();
  }

  project(): AnnotationHostProject | undefined {
    return this.readings.project;
  }

  organizationId(): string | undefined {
    return this.readings.organizationId;
  }

  currentUser(): AnnotationHostUser | undefined {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  isLiteMember(): boolean {
    return this.readings.isLiteMember;
  }

  isOwnPersonalWorkspace(): boolean {
    return this.readings.isOwnPersonalWorkspace;
  }

  route(): AnnotationRouteReading {
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

  succeeded(notice: AnnotationSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: AnnotationFailureNotice): void {
    this.actions.failed(failure);
  }
}
