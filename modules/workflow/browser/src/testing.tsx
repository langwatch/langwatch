/**
 * Test utilities: mount Workflows screens inside a fake host that records surface interactions.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ReactElement } from "react";

import { workflowHostSlice } from "./behavior/workflow-host.store.ts";
import type {
  WorkflowCopyTarget,
  WorkflowFailureNotice,
  WorkflowHostSlice,
  WorkflowRouteReading,
  WorkflowScope,
  WorkflowSuccessNotice,
} from "./model/workflow-host.ts";

export type QueryWrite = {
  next: Readonly<Record<string, string | undefined>>;
  options?: { replace?: boolean };
};

export class FakeWorkflowHost implements WorkflowHostSlice {
  readonly navigations: string[] = [];
  /** How many times a screen asked to step back, which is all a test can assert. */
  backs = 0;
  readonly queryWrites: QueryWrite[] = [];
  readonly successes: WorkflowSuccessNotice[] = [];
  readonly failures: WorkflowFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<WorkflowScope>;
      permissions?: readonly string[];
      copyTargets?: readonly WorkflowCopyTarget[];
      params?: Readonly<Record<string, string | undefined>>;
      query?: Readonly<Record<string, string | undefined>>;
      pathname?: string;
    } = {},
  ) {}

  scope(): WorkflowScope {
    return { projectId: "project-1", projectSlug: "my-project", ...this.options.scope };
  }

  hasPermission(permission: string): boolean {
    return (this.options.permissions ?? []).includes(permission);
  }

  copyTargets(): readonly WorkflowCopyTarget[] {
    return this.options.copyTargets ?? [];
  }

  route(): WorkflowRouteReading {
    return {
      params: this.options.params ?? {},
      query: this.options.query ?? {},
      pathname: this.options.pathname ?? "/",
    };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.queryWrites.push(options ? { next, options } : { next });
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  back(): void {
    this.backs += 1;
  }

  succeeded(notice: WorkflowSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: WorkflowFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Publishes a host into `workflow:host`, as workflow's host mount does. */
export function publishWorkflowHost(host: WorkflowHostSlice): void {
  workflowHostSlice.setState(host, true);
}

/** Renders a screen inside the Design System's provider with a host published. */
export function renderWithWorkflowHost(
  element: ReactElement,
  host: FakeWorkflowHost = new FakeWorkflowHost(),
) {
  publishWorkflowHost(host);
  return { host, ...renderWithDesignSystem(element) };
}
