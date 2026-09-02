/**
 * The SCIM package's host port, answered from this application.
 *
 * `@langwatch/enterprise-scim-web` declares what its screen needs — the
 * organization, the base URL an identity provider posts to, and two notices —
 * as one abstract class it can define without importing anything of ours.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  ScimHostPort,
  type ScimFailureNotice,
  type ScimSuccessNotice,
} from "@langwatch/enterprise-scim-web/screens/scim";

/** The grant the platform page asked for, unchanged. */
export const SCIM_PAGE_PERMISSION = "organization:manage";

export type ScimHostReadings = {
  organizationId: string | undefined;
  scimBaseUrl: string;
};

export type ScimHostActions = {
  succeeded: (notice: ScimSuccessNotice) => void;
  failed: (failure: ScimFailureNotice) => void;
};

export class UiScimHost extends ScimHostPort {
  static create(readings: ScimHostReadings, actions: ScimHostActions): UiScimHost {
    return new UiScimHost(readings, actions);
  }

  private constructor(
    private readonly readings: ScimHostReadings,
    private readonly actions: ScimHostActions,
  ) {
    super();
  }

  organizationId(): string | undefined {
    return this.readings.organizationId;
  }

  scimBaseUrl(): string {
    return this.readings.scimBaseUrl;
  }

  succeeded(notice: ScimSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: ScimFailureNotice): void {
    this.actions.failed(failure);
  }
}
