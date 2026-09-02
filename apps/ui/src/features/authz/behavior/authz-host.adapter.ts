/**
 * The AuthZ package's host port, answered from this application.
 *
 * `@langwatch/authz-web` declares what its two screens need — the organization,
 * one grant, the plan tier and the two notices — as one abstract class it can
 * define without importing anything of ours. This is the other half: a plain
 * adapter over what the application shell has already resolved.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in
 * the one component that mounts it.
 */

import {
  AuthzHostPort,
  type AuthzFailureNotice,
  type AuthzHostScope,
  type AuthzPlanReading,
  type AuthzSuccessNotice,
} from "@langwatch/authz-web/screens/authz";

export type AuthzHostReadings = {
  scope: AuthzHostScope;
  plan: AuthzPlanReading;
};

export type AuthzHostActions = {
  hasPermission: (permission: string) => boolean;
  succeeded: (notice: AuthzSuccessNotice) => void;
  failed: (failure: AuthzFailureNotice) => void;
};

export class UiAuthzHost extends AuthzHostPort {
  static create(readings: AuthzHostReadings, actions: AuthzHostActions): UiAuthzHost {
    return new UiAuthzHost(readings, actions);
  }

  private constructor(
    private readonly readings: AuthzHostReadings,
    private readonly actions: AuthzHostActions,
  ) {
    super();
  }

  scope(): AuthzHostScope {
    return this.readings.scope;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  plan(): AuthzPlanReading {
    return this.readings.plan;
  }

  succeeded(notice: AuthzSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: AuthzFailureNotice): void {
    this.actions.failed(failure);
  }
}
