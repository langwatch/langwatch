/**
 * What one organization on this install says about Connect (ADR-156): its
 * license, where its sync stands, and the services its administrator switched
 * off — refusals, never approvals, so a bought service works unopened.
 */

import type { Instant } from "@langwatch/time";

export interface ConnectOrganizationRecord {
  readonly organizationId: string;
  readonly license: string | null;
  readonly servicesDisabled: string[];
  readonly lastSyncAt: Instant | null;
  readonly lastSyncError: string | null;
}

export interface ConnectOrganizationRepository {
  findById(organizationId: string): Promise<ConnectOrganizationRecord | null>;

  /** Every organization on this install that holds a license, of any kind. */
  findLicensedOrganizationIds(): Promise<string[]>;

  setServicesDisabled(params: {
    organizationId: string;
    servicesDisabled: readonly string[];
  }): Promise<void>;

  /** What the last sync left behind: the moment it landed, or why it did not. */
  recordSyncOutcome(params: {
    organizationId: string;
    at: Instant;
    error: string | null;
  }): Promise<void>;
}
