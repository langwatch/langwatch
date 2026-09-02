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
  type AuthPublicEnvironment,
  type AuthRouteReading,
} from "@langwatch/auth-web/screens/auth";

export type AuthHostReadings = {
  publicEnvironment: AuthPublicEnvironment;
  route: AuthRouteReading;
};

export class UiAuthHost extends AuthHostPort {
  static create(readings: AuthHostReadings): UiAuthHost {
    return new UiAuthHost(readings);
  }

  private constructor(private readonly readings: AuthHostReadings) {
    super();
  }

  publicEnvironment(): AuthPublicEnvironment {
    return this.readings.publicEnvironment;
  }

  route(): AuthRouteReading {
    return this.readings.route;
  }
}
