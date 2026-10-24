/**
 * Test harness for the Integrations screen that records port interactions:
 * departures, external opens, query writes, and failures.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { type RenderResult } from "@testing-library/react";
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
  readonly langyQuestions: string[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<GithubHostScope>;
      query?: Readonly<Record<string, string | undefined>>;
      /** Grants the reader holds; every grant when omitted. */
      permissions?: readonly string[];
      /** Whether Langy is installed to be asked; yes when omitted. */
      langy?: boolean;
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

  canAskLangy(): boolean {
    return this.options.langy ?? true;
  }

  askLangy(question: string): void {
    this.langyQuestions.push(question);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithGithubHost(
  element: ReactElement,
  host: FakeGithubHost = new FakeGithubHost(),
): RenderResult & { host: FakeGithubHost } {
  return {
    host,
    ...renderWithDesignSystem(<GithubHostProvider value={host}>{element}</GithubHostProvider>),
  };
}
