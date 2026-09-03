/**
 * The GitHub package's host port, answered from this application.
 *
 * `@langwatch/github-web` declares what its screen needs — the organization in
 * scope, the address, a failure notice and the two departures to github.com —
 * as one abstract class it can define without importing anything of ours. This
 * is the other half: a plain adapter over the capabilities the application
 * shell already resolves, plus `behavior/ui-departure`, which owns the `window`
 * calls the platform page made inline.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  GithubHostPort,
  type GithubFailureNotice,
  type GithubHostScope,
  type GithubRouteReading,
} from "@langwatch/github-web/screens/integrations";

/** The grant the platform page asked for, unchanged. */
export const INTEGRATIONS_PAGE_PERMISSION = "organization:manage";

export type GithubHostReadings = {
  scope: GithubHostScope;
  route: GithubRouteReading;
};

export type GithubHostActions = {
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  leaveTo: (url: string) => void;
  openExternal: (url: string) => void;
  failed: (failure: GithubFailureNotice) => void;
};

export class UiGithubHost extends GithubHostPort {
  static create(readings: GithubHostReadings, actions: GithubHostActions): UiGithubHost {
    return new UiGithubHost(readings, actions);
  }

  private constructor(
    private readonly readings: GithubHostReadings,
    private readonly actions: GithubHostActions,
  ) {
    super();
  }

  scope(): GithubHostScope {
    return this.readings.scope;
  }

  route(): GithubRouteReading {
    return this.readings.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  leaveTo(url: string): void {
    this.actions.leaveTo(url);
  }

  openExternal(url: string): void {
    this.actions.openExternal(url);
  }

  failed(failure: GithubFailureNotice): void {
    this.actions.failed(failure);
  }
}
