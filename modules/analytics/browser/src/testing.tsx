/**
 * What an analytics test mounts instead of an application: a double for
 * `AnalyticsHostApi` plus the Chakra provider. Notices, navigations and
 * query writes are RECORDED, not performed, so tests assert what the screen SAID.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import {
  AnalyticsHostApi,
  AnalyticsHostProvider,
  type AnalyticsAlertAuthoring,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "./model/analytics-host.ts";

export type StubAnalyticsHostOptions = {
  project?: AnalyticsHostProject | undefined;
  organizationId?: string | undefined;
  permissions?: readonly string[];
  route?: AnalyticsRouteReading;
};

/** A host that answers from fixtures and records everything it is told. */
export class StubAnalyticsHost extends AnalyticsHostApi {
  readonly successes: AnalyticsSuccessNotice[] = [];
  readonly failures: AnalyticsFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly queries: Readonly<Record<string, string | undefined>>[] = [];
  readonly alertAuthorings: AnalyticsAlertAuthoring[] = [];

  constructor(private readonly options: StubAnalyticsHostOptions = {}) {
    super();
  }

  project(): AnalyticsHostProject | undefined {
    return "project" in this.options
      ? this.options.project
      : {
          id: "proj-1",
          slug: "test-project",
          name: "Test Project",
          hasFirstMessage: true,
        };
  }

  organizationId(): string | undefined {
    return "organizationId" in this.options ? this.options.organizationId : "org-1";
  }

  hasPermission(permission: string): boolean {
    return (this.options.permissions ?? ["analytics:view", "cost:view", "traces:view"]).includes(
      permission,
    );
  }

  route(): AnalyticsRouteReading {
    return this.options.route ?? { params: {}, query: {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push(next);
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  openAutomationDrawer(request: AnalyticsAlertAuthoring): void {
    this.alertAuthorings.push(request);
  }

  succeeded(notice: AnalyticsSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: AnalyticsFailureNotice): void {
    this.failures.push(failure);
  }

  /** The last query write, which is what an address assertion is about. */
  get lastQuery(): Readonly<Record<string, string | undefined>> | undefined {
    return this.queries.at(-1);
  }
}

/** The providers every analytics component needs before it can render. */
export function AnalyticsTestHarness({
  host,
  children,
}: {
  host: AnalyticsHostApi;
  children: ReactNode;
}) {
  return (
    <ChakraProvider value={defaultSystem}>
      <AnalyticsHostProvider value={host}>{children}</AnalyticsHostProvider>
    </ChakraProvider>
  );
}

/** Renders one element inside the harness and hands back the host it recorded on. */
export function renderWithAnalyticsHost(
  element: ReactElement,
  options: StubAnalyticsHostOptions = {},
): RenderResult & { host: StubAnalyticsHost } {
  const host = new StubAnalyticsHost(options);
  return {
    ...render(<AnalyticsTestHarness host={host}>{element}</AnalyticsTestHarness>),
    host,
  };
}
