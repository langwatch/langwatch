/**
 * What this package's screen suites mount the Workflows screens inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what a screen asked the application
 * to do — where it navigated, what it wrote to the address, and every notice it
 * reported — which is exactly the surface the real adapter answers.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  WorkflowHostPort,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "./model/workflow-host";

export type QueryWrite = {
  next: Readonly<Record<string, string | undefined>>;
  options?: { replace?: boolean };
};

export class FakeWorkflowHost extends WorkflowHostPort {
  readonly navigations: string[] = [];
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
    } = {},
  ) {
    super();
  }

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
    return { params: this.options.params ?? {}, query: this.options.query ?? {} };
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

  succeeded(notice: WorkflowSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: WorkflowFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders a screen inside the Design System's provider and a host. */
export function renderWithWorkflowHost(
  element: ReactElement,
  host: FakeWorkflowHost = new FakeWorkflowHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <WorkflowHostProvider value={host}>{element}</WorkflowHostProvider>
      </ChakraProvider>,
    ),
  };
}
