/**
 * What this package's suites mount a screen inside. A fake host RECORDS
 * what a screen asked of it, rather than mocking a module; not exported,
 * since only this package's tests should construct one.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  ModelProviderHostApi,
  ModelProviderHostProvider,
  type ModelProviderAvailableScopes,
  type ModelProviderFailureNotice,
  type ModelProviderHostScope,
  type ModelProviderPlatformDrawer,
  type ModelProviderRouteReading,
  type ModelProviderSuccessNotice,
} from "./model/model-provider-host.ts";

/** One recorded `openPlatformDrawer` call. */
export type RecordedDrawerOpen = {
  drawer: ModelProviderPlatformDrawer;
  params: Readonly<Record<string, string | undefined>>;
};

export class FakeModelProviderHost extends ModelProviderHostApi {
  readonly queryWrites: Readonly<Record<string, string | undefined>>[] = [];
  readonly drawerOpens: RecordedDrawerOpen[] = [];
  readonly successes: ModelProviderSuccessNotice[] = [];
  readonly failures: ModelProviderFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: ModelProviderHostScope;
      grants?: ReadonlySet<string>;
      availableScopes?: ModelProviderAvailableScopes;
      query?: Readonly<Record<string, string | undefined>>;
      reportedGlobally?: boolean;
    } = {},
  ) {
    super();
  }

  scope(): ModelProviderHostScope {
    return (
      this.options.scope ?? {
        organizationId: "org-1",
        teamId: "team-1",
        projectId: "proj-1",
        projectSlug: "web-app",
      }
    );
  }

  hasPermission(permission: string): boolean {
    return (this.options.grants ?? new Set(["project:manage", "organization:view"])).has(
      permission,
    );
  }

  availableScopes(): ModelProviderAvailableScopes {
    return (
      this.options.availableScopes ?? {
        organization: { id: "org-1", name: "ACME" },
        teams: [{ id: "team-1", name: "Platform" }],
        projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
      }
    );
  }

  route(): ModelProviderRouteReading {
    return { params: {}, query: this.options.query ?? {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queryWrites.push(next);
  }

  succeeded(notice: ModelProviderSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: ModelProviderFailureNotice): void {
    this.failures.push(failure);
  }

  /**
   * Takes the error even though the default answer ignores it, so a suite that
   * needs "this ONE failure was already on screen" can override with a real
   * predicate — which is the only interesting shape of this question.
   */
  isReportedGlobally(_error: unknown): boolean {
    return this.options.reportedGlobally ?? false;
  }

  openPlatformDrawer(request: {
    drawer: ModelProviderPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    this.drawerOpens.push({ drawer: request.drawer, params: request.params ?? {} });
  }
}

/** Renders a screen inside the Design System's provider and a host. */
export function renderWithModelProviderHost(
  element: ReactElement,
  host: FakeModelProviderHost = new FakeModelProviderHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ModelProviderHostProvider value={host}>{element}</ModelProviderHostProvider>
      </ChakraProvider>,
    ),
  };
}
