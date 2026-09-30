/**
 * Test harness for the Integrations screen that records port interactions:
 * departures, external opens, query writes, and failures.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  GithubHostApi,
  GithubHostProvider,
  type GithubFailureNotice,
  type GithubHostScope,
  type GithubRouteReading,
} from "./model/github-host.ts";

export type QueryWrite = {
  next: Readonly<Record<string, string | undefined>>;
  options?: { replace?: boolean };
};

export class FakeGithubHost extends GithubHostApi {
  readonly departures: string[] = [];
  readonly externals: string[] = [];
  readonly queryWrites: QueryWrite[] = [];
  readonly failures: GithubFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<GithubHostScope>;
      query?: Readonly<Record<string, string | undefined>>;
      /** Grants the reader holds; every grant when omitted. */
      permissions?: readonly string[];
    } = {},
  ) {
    super();
  }

  scope(): GithubHostScope {
    return { organizationId: "org-1", ...this.options.scope };
  }

  route(): GithubRouteReading {
    return { params: {}, query: this.options.query ?? {} };
  }

  hasPermission(permission: string): boolean {
    return this.options.permissions?.includes(permission) ?? true;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.queryWrites.push(options ? { next, options } : { next });
  }

  leaveTo(url: string): void {
    this.departures.push(url);
  }

  openExternal(url: string): void {
    this.externals.push(url);
  }

  failed(failure: GithubFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithGithubHost(
  element: ReactElement,
  host: FakeGithubHost = new FakeGithubHost(),
): RenderResult & { host: FakeGithubHost } {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <GithubHostProvider value={host}>{element}</GithubHostProvider>
      </ChakraProvider>,
    ),
  };
}
