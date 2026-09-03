/**
 * The front door's host port, answered from this application.
 *
 * `@langwatch/auth-web` declares what its eight screens need — the
 * deployment's public configuration and the address they were opened at — as
 * one abstract class it can define without importing anything of ours. This is
 * the other half: a plain adapter over what the application shell already
 * resolves.
 *
 * NOTHING HERE FETCHES, AND NOTHING HERE AUTHENTICATES. The values arrive as
 * arguments, so the adapter is a value object a test can construct. The
 * identity wire — signing in, signing up, signing out, reading the session —
 * stays inside the package as its own single better-auth client, which is what
 * keeps ONE identity seam for the whole front door instead of one per
 * composition.
 */

import {
  AuthHostPort,
  type AuthFailureNotice,
  type AuthPublicEnvironment,
  type AuthRouteReading,
} from "@langwatch/auth-web/screens/auth";

export type AuthHostReadings = {
  publicEnvironment: AuthPublicEnvironment;
  route: AuthRouteReading;
};

/**
 * The one thing the front door DOES rather than reads.
 *
 * It is the application's feedback capability, forwarded: `ui-feedback`
 * resolves the words from the failure's code against the presentation registry,
 * so the two sign-in screens stop composing their own error copy over the
 * Design System toaster.
 */
export type AuthHostActions = {
  failed: (failure: AuthFailureNotice) => void;
};

export class UiAuthHost extends AuthHostPort {
  static create(readings: AuthHostReadings, actions: AuthHostActions): UiAuthHost {
    return new UiAuthHost(readings, actions);
  }

  private constructor(
    private readonly readings: AuthHostReadings,
    private readonly actions: AuthHostActions,
  ) {
    super();
  }

  publicEnvironment(): AuthPublicEnvironment {
    return this.readings.publicEnvironment;
  }

  route(): AuthRouteReading {
    return this.readings.route;
  }

  failed(failure: AuthFailureNotice): void {
    this.actions.failed(failure);
  }
}
