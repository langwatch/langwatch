/**
 * The notification package's host port, answered from this application.
 *
 * `@langwatch/notification-web` declares what its screen needs — the project in
 * scope, one grant and two notices — as one abstract class it can define
 * without importing anything of ours. This is the other half: a plain adapter
 * over what the application shell has already resolved.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  NotificationHostPort,
  type NotificationFailureNotice,
  type NotificationHostProject,
  type NotificationSuccessNotice,
} from "@langwatch/notification-web/screens/email-suppressions";

/** The grant the platform page asked for, unchanged. */
export const EMAIL_SUPPRESSIONS_PAGE_PERMISSION = "triggers:view";

export type NotificationHostReadings = {
  project: NotificationHostProject | undefined;
};

export type NotificationHostActions = {
  hasPermission: (permission: string) => boolean;
  succeeded: (notice: NotificationSuccessNotice) => void;
  failed: (failure: NotificationFailureNotice) => void;
};

export class UiNotificationHost extends NotificationHostPort {
  static create(
    readings: NotificationHostReadings,
    actions: NotificationHostActions,
  ): UiNotificationHost {
    return new UiNotificationHost(readings, actions);
  }

  private constructor(
    private readonly readings: NotificationHostReadings,
    private readonly actions: NotificationHostActions,
  ) {
    super();
  }

  project(): NotificationHostProject | undefined {
    return this.readings.project;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  succeeded(notice: NotificationSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: NotificationFailureNotice): void {
    this.actions.failed(failure);
  }
}
