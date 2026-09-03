/**
 * The billing package's host port, answered from this application.
 *
 * `@langwatch/enterprise-billing-web` declares what its three screens need —
 * the organization and its pricing model, the active team an invitation lands
 * in, the deployment as a settled pair, the query string Stripe returns
 * through, the departure to a checkout and two notices — as one abstract class
 * it can define without importing anything of ours.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  BillingHostPort,
  type BillingFailureNotice,
  type BillingHostOrganization,
  type BillingSuccessNotice,
} from "@langwatch/enterprise-billing-web/screens/billing";

/** The grant the plans page asked for, unchanged. */
export const PLANS_PAGE_PERMISSION = "organization:view";

/** The grant the usage page asked for, unchanged. */
export const USAGE_PAGE_PERMISSION = "cost:view";

/**
 * The grant the subscription page asked for: NONE.
 *
 * One for one with the platform page, which was wrapped in no
 * `withPermissionGuard` at all. Every procedure behind it states its own
 * policy. Carried rather than tidied — inventing a guard is a change to who can
 * reach an address, and a page move does not own that decision.
 */
export const SUBSCRIPTION_PAGE_PERMISSION = void 0;

export type BillingHostReadings = {
  organization: BillingHostOrganization | undefined;
  activeTeamId: string | undefined;
  isSaaS: boolean;
  isDeploymentSettled: boolean;
  routeQuery: Readonly<Record<string, string | undefined>>;
  applicationOrigin: string;
};

export type BillingHostActions = {
  navigate: (to: string) => void;
  leaveTo: (url: string) => void;
  succeeded: (notice: BillingSuccessNotice) => void;
  failed: (failure: BillingFailureNotice) => void;
};

export class UiBillingHost extends BillingHostPort {
  static create(readings: BillingHostReadings, actions: BillingHostActions): UiBillingHost {
    return new UiBillingHost(readings, actions);
  }

  private constructor(
    private readonly readings: BillingHostReadings,
    private readonly actions: BillingHostActions,
  ) {
    super();
  }

  organization(): BillingHostOrganization | undefined {
    return this.readings.organization;
  }

  activeTeamId(): string | undefined {
    return this.readings.activeTeamId;
  }

  isSaaS(): boolean {
    return this.readings.isSaaS;
  }

  isDeploymentSettled(): boolean {
    return this.readings.isDeploymentSettled;
  }

  routeQuery(): Readonly<Record<string, string | undefined>> {
    return this.readings.routeQuery;
  }

  applicationOrigin(): string {
    return this.readings.applicationOrigin;
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  leaveTo(url: string): void {
    this.actions.leaveTo(url);
  }

  succeeded(notice: BillingSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: BillingFailureNotice): void {
    this.actions.failed(failure);
  }
}
