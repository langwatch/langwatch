/**
 * Test utilities: mount Workflows screens inside a fake host that records surface interactions.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  WorkflowHostApi,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "@langwatch/workflow-browser-kit";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export type QueryWrite = {
  next: Readonly<Record<string, string | undefined>>;
  options?: { replace?: boolean };
};

export class FakeWorkflowHost extends WorkflowHostApi {
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
