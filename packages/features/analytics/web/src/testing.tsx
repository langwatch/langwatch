/**
 * What an analytics test mounts instead of an application.
 *
 * Every screen and section in this package reads its project, the reader's
 * grants, the address and the two notices off `AnalyticsHostPort`. A test that
 * renders one therefore needs a host, and building a real one means building a
 * browser application; this is the double, plus the Chakra provider the
 * components need to render at all.
 *
 * The notices, the navigations and the query writes are RECORDED rather than
 * performed, so a test asserts on what the screen SAID — which is the point of
 * the port, and the only way to assert on an address whose overlay the
 * application chrome has not mounted yet.
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
  AnalyticsHostPort,
  AnalyticsHostProvider,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "./model/analytics-host";

export type StubAnalyticsHostOptions = {
  project?: AnalyticsHostProject | undefined;
  organizationId?: string | undefined;
  permissions?: readonly string[];
  route?: AnalyticsRouteReading;
};

/** A host that answers from fixtures and records everything it is told. */
export class StubAnalyticsHost extends AnalyticsHostPort {
  readonly successes: AnalyticsSuccessNotice[] = [];
  readonly failures: AnalyticsFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly queries: Array<Readonly<Record<string, string | undefined>>> = [];

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
  host: AnalyticsHostPort;
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
