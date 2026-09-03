/**
 * The licensing package's host port, answered from this application.
 *
 * `@langwatch/enterprise-licensing-web` declares what its screen needs — the
 * organization, the deployment as a settled pair, where to buy a license, a way
 * to drop every cached read and two notices — as one abstract class it can
 * define without importing anything of ours.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  LicensingHostPort,
  type LicensingFailureNotice,
  type LicensingSuccessNotice,
} from "@langwatch/enterprise-licensing-web/screens/license";

/**
 * The grant the license key carries: NONE.
 *
 * One for one with the platform page, which was the only settings page wrapped
 * in no `withPermissionGuard` at all. Every procedure behind it states its own
 * policy, so a reader without `organization:view` meets a card whose read
 * refused rather than a license they may not see.
 */
export const LICENSE_PAGE_PERMISSION = void 0;

export type LicensingHostReadings = {
  organizationId: string | undefined;
  isSaaS: boolean;
  isDeploymentSettled: boolean;
  licensePurchaseUrl: string | undefined;
};

export type LicensingHostActions = {
  refreshPlanDerivedState: () => void;
  succeeded: (notice: LicensingSuccessNotice) => void;
  failed: (failure: LicensingFailureNotice) => void;
};

export class UiLicensingHost extends LicensingHostPort {
  static create(
    readings: LicensingHostReadings,
    actions: LicensingHostActions,
  ): UiLicensingHost {
    return new UiLicensingHost(readings, actions);
  }

  private constructor(
    private readonly readings: LicensingHostReadings,
    private readonly actions: LicensingHostActions,
  ) {
    super();
  }

  organizationId(): string | undefined {
    return this.readings.organizationId;
  }

  isSaaS(): boolean {
    return this.readings.isSaaS;
  }

  isDeploymentSettled(): boolean {
    return this.readings.isDeploymentSettled;
  }

  licensePurchaseUrl(): string | undefined {
    return this.readings.licensePurchaseUrl;
  }

  refreshPlanDerivedState(): void {
    this.actions.refreshPlanDerivedState();
  }

  succeeded(notice: LicensingSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: LicensingFailureNotice): void {
    this.actions.failed(failure);
  }
}
