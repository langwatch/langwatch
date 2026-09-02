/**
 * The workflow package's host port, answered from this application.
 *
 * `@langwatch/workflow-web` declares what its screens need — the project in
 * scope, the reader's grants, the projects a workflow may be replicated into,
 * the address, the two notices and the navigation into the studio — as one
 * abstract class it can define without importing anything of ours. This is the
 * other half: a plain adapter over the capabilities the application shell
 * already resolves.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 *
 * `navigate` IS LOAD-BEARING FOR THIS FAMILY rather than incidental. Creating a
 * workflow ends at `/:project/studio/:id` and opening a card goes to the same
 * place, and BOTH addresses are still served by `platform/app` — the studio key
 * did not move. A page served out of this package and a page served out of the
 * application are one product to the reader, and the shared route table is what
 * makes that true.
 */

import type {
  WorkflowCopyTarget,
  WorkflowFailureNotice,
  WorkflowRouteReading,
  WorkflowScope,
  WorkflowSuccessNotice,
} from "@langwatch/workflow-web/screens/workflows";
import { WorkflowHostPort } from "@langwatch/workflow-web/screens/workflows";

/** The grant the platform workflows page asked for, unchanged. */
export const WORKFLOWS_PAGE_PERMISSION = "workflows:view";

/**
 * The grant a replication target is judged by.
 *
 * `useProjectsForCopy("workflows:create")` is what `CopyWorkflowDialog` asked
 * for, and it is the right question: replicating writes a NEW workflow into the
 * target project.
 */
export const WORKFLOW_COPY_PERMISSION = "workflows:create";

export type WorkflowHostReadings = {
  scope: WorkflowScope;
  hasPermission: (permission: string) => boolean;
  copyTargets: readonly WorkflowCopyTarget[];
  route: WorkflowRouteReading;
};

export type WorkflowHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  navigate: (to: string) => void;
  succeeded: (notice: WorkflowSuccessNotice) => void;
  failed: (failure: WorkflowFailureNotice) => void;
};

export class UiWorkflowHost extends WorkflowHostPort {
  static create(readings: WorkflowHostReadings, actions: WorkflowHostActions): UiWorkflowHost {
    return new UiWorkflowHost(readings, actions);
  }

  private constructor(
    private readonly readings: WorkflowHostReadings,
    private readonly actions: WorkflowHostActions,
  ) {
    super();
  }

  scope(): WorkflowScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.readings.hasPermission(permission);
  }

  copyTargets(): readonly WorkflowCopyTarget[] {
    return this.readings.copyTargets;
  }

  route(): WorkflowRouteReading {
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

  succeeded(notice: WorkflowSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: WorkflowFailureNotice): void {
    this.actions.failed(failure);
  }
}
