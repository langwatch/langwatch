/**
 * The Datasets package's host port, answered from this application.
 *
 * `@langwatch/dataset-web` declares what its two screens and their four
 * overlays need — the project, the reader's grants and membership, where a
 * dataset may be replicated to, the address, and the two notices — as one
 * abstract class it can define without importing anything of ours. This is the
 * other half: a plain adapter over the capabilities the application shell
 * already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in the
 * one component that mounts it.
 *
 * `isReportedGlobally` IS A RECORDED GAP RATHER THAN A CARRIED BEHAVIOUR, and
 * the honest answer here is `false`. `platform/app` dedupes a refusal that one
 * of its four global interceptors already rendered as a modal or a bespoke toast
 * — the license limit, the lite-member restriction, a missing model, a disabled
 * provider — and the datasets page asked `isHandledByGlobalHandler` before
 * toasting so a reader was not told the same thing twice. That answer is a
 * `WeakSet` those interceptors write to, and the interceptors live on
 * `platform/app`'s own MutationCache (`utils/api.tsx`), which does NOT wrap the
 * client `apps/ui` builds for a package's hooks. Nothing reaching this screen
 * has been through them, so nothing has been reported twice; the screen's own
 * notice is the only one. It closes when the global interceptors move to the
 * transport rather than to one application's cache.
 */

import type {
  DatasetCopyTarget,
  DatasetFailureNotice,
  DatasetHostProject,
  DatasetRouteReading,
  DatasetSuccessNotice,
} from "@langwatch/dataset-web/screens/datasets";
import { DatasetHostPort } from "@langwatch/dataset-web/screens/datasets";

/** The grant the platform list page asked for, unchanged. */
export const DATASET_PAGE_PERMISSION = "datasets:view";

export type DatasetHostReadings = {
  project: DatasetHostProject | undefined;
  hasPermission: (permission: string) => boolean;
  isLiteMember: boolean;
  copyTargets: readonly DatasetCopyTarget[];
  route: DatasetRouteReading;
};

export type DatasetHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: DatasetSuccessNotice) => void;
  failed: (failure: DatasetFailureNotice) => void;
};

export class UiDatasetHost extends DatasetHostPort {
  static create(readings: DatasetHostReadings, actions: DatasetHostActions): UiDatasetHost {
    return new UiDatasetHost(readings, actions);
  }

  private constructor(
    private readonly readings: DatasetHostReadings,
    private readonly actions: DatasetHostActions,
  ) {
    super();
  }

  project(): DatasetHostProject | undefined {
    return this.readings.project;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  isLiteMember(): boolean {
    return this.readings.isLiteMember;
  }

  copyTargets(): readonly DatasetCopyTarget[] {
    return this.readings.copyTargets;
  }

  route(): DatasetRouteReading {
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

  succeeded(notice: DatasetSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: DatasetFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * Whether the application has already told the reader about this failure.
   *
   * Always false in this composition — see the note at the top of the file. It
   * stays on the port rather than being dropped from it, because the screen's
   * question is the right one and it is this side of the seam that has no
   * answer yet.
   */
  isReportedGlobally(): boolean {
    return false;
  }
}
