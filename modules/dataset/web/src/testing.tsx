/** Test host double for Datasets screens. Notices recorded (not rendered) for
 * assertion on screen output, not toast DOM.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  DatasetHostApi,
  DatasetHostProvider,
  type DatasetCopyTarget,
  type DatasetFailureNotice,
  type DatasetHostProject,
  type DatasetRouteReading,
  type DatasetSuccessNotice,
} from "./model/dataset-host.ts";

export type StubDatasetHostOptions = {
  project?: DatasetHostProject | undefined;
  permissions?: readonly string[];
  isLiteMember?: boolean;
  copyTargets?: readonly DatasetCopyTarget[];
  route?: DatasetRouteReading;
  reportedGlobally?: boolean;
};

/** A host that answers from fixtures and records everything it is told. */
export class StubDatasetHost extends DatasetHostApi {
  readonly successes: DatasetSuccessNotice[] = [];
  readonly failures: DatasetFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly queries: Array<Readonly<Record<string, string | undefined>>> = [];

  constructor(private readonly options: StubDatasetHostOptions = {}) {
    super();
  }

  project(): DatasetHostProject | undefined {
    return "project" in this.options
      ? this.options.project
      : { id: "proj-1", slug: "test-project", name: "Test Project" };
  }

  hasPermission(permission: string): boolean {
    return (this.options.permissions ?? ["datasets:view", "evaluations:manage"]).includes(
      permission,
    );
  }

  isLiteMember(): boolean {
    return this.options.isLiteMember ?? false;
  }

  copyTargets(): readonly DatasetCopyTarget[] {
    return this.options.copyTargets ?? [];
  }

  route(): DatasetRouteReading {
    return this.options.route ?? { params: {}, query: {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push(next);
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  succeeded(notice: DatasetSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: DatasetFailureNotice): void {
    this.failures.push(failure);
  }

  isReportedGlobally(): boolean {
    return this.options.reportedGlobally ?? false;
  }
}

/** The providers every Datasets component needs before it can render. */
export function DatasetTestHarness({
  host,
  children,
}: {
  host: DatasetHostApi;
  children: ReactNode;
}) {
  return (
    <ChakraProvider value={defaultSystem}>
      <DatasetHostProvider value={host}>{children}</DatasetHostProvider>
    </ChakraProvider>
  );
}

/** Renders one element inside the harness and hands back the host it recorded on. */
export function renderWithDatasetHost(
  element: ReactElement,
  options: StubDatasetHostOptions = {},
): RenderResult & { host: StubDatasetHost } {
  const host = new StubDatasetHost(options);
  return {
    ...render(<DatasetTestHarness host={host}>{element}</DatasetTestHarness>),
    host,
  };
}
