/**
 * What a Datasets test mounts instead of an application.
 *
 * Every screen and overlay in this package reads its project, its grants, its
 * replication targets, the address and the two notices off `DatasetHostPort`.
 * A test that renders one therefore needs a host, and building a real one means
 * building a browser application; this is the double, plus the Chakra provider
 * the components need to render at all.
 *
 * The notices are RECORDED rather than rendered, so a test asserts on what the
 * screen said rather than on a toast's DOM — which is the point of the port.
 *
 * `testing.tsx` sits at the package root by the same rule `index.ts` does: it is
 * a package entry, not private implementation, and the governed layout names
 * both as root exceptions. It is deliberately not a package export — nothing
 * outside this package's own suites should mount a fake host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  DatasetHostPort,
  DatasetHostProvider,
  type DatasetCopyTarget,
  type DatasetFailureNotice,
  type DatasetHostProject,
  type DatasetRouteReading,
  type DatasetSuccessNotice,
} from "./model/dataset-host";

export type StubDatasetHostOptions = {
  project?: DatasetHostProject | undefined;
  permissions?: readonly string[];
  isLiteMember?: boolean;
  copyTargets?: readonly DatasetCopyTarget[];
  route?: DatasetRouteReading;
  reportedGlobally?: boolean;
};

/** A host that answers from fixtures and records everything it is told. */
export class StubDatasetHost extends DatasetHostPort {
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
  host: DatasetHostPort;
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
