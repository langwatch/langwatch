/**
 * What this package's suites mount the Integrations screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to do — where it tried to LEAVE to, what it opened in a new tab,
 * the address writes and the failures it reported — which is exactly the
 * surface the real adapter answers.
 *
 * BOTH DEPARTURES ARE RECORDED SEPARATELY, and that is the whole reason they
 * are two port methods rather than one. Connecting REPLACES this document;
 * disconnecting opens a second one. jsdom performs neither, so a screen that
 * called `window` directly could only be asserted by spying on a global.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  GithubHostPort,
  GithubHostProvider,
  type GithubFailureNotice,
  type GithubHostScope,
  type GithubRouteReading,
} from "./model/github-host";

export type QueryWrite = {
  next: Readonly<Record<string, string | undefined>>;
  options?: { replace?: boolean };
};

export class FakeGithubHost extends GithubHostPort {
  readonly departures: string[] = [];
  readonly externals: string[] = [];
  readonly queryWrites: QueryWrite[] = [];
  readonly failures: GithubFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<GithubHostScope>;
      query?: Readonly<Record<string, string | undefined>>;
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
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <GithubHostProvider value={host}>{element}</GithubHostProvider>
      </ChakraProvider>,
    ),
  };
}
