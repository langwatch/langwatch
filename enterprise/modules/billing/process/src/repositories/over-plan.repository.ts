// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Instant } from "@langwatch/time";

/** An open over-plan mark (specs/billing/over-plan-trace-withholding.feature). */
export type OverPlanMark = Readonly<{
  subscriptionId: string;
  organizationId: string;
  since: Instant;
}>;

/** The over-plan columns on Subscription. */
export abstract class OverPlanRepository {
  /** Opens the mark from `since`; a later downgrade of the same row reopens it. */
  abstract mark(input: { subscriptionId: string; since: Instant }): Promise<void>;
  /** Ends an open mark; false when it was not open (another sweep ended it). */
  abstract end(input: { subscriptionId: string; endedAt: Instant }): Promise<boolean>;
  abstract findOpen(): Promise<OverPlanMark[]>;
  /** The organization's open marks, newest first. */
  abstract findOpenForOrganization(organizationId: string): Promise<OverPlanMark[]>;
}
