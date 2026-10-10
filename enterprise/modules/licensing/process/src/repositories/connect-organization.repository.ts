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

/** A licence customer as organization's table names it, read through its share (C3c, R40). */
export interface OrganizationCustomerRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface ConnectOrganizationRepository {
  findById(organizationId: string): Promise<ConnectOrganizationRecord | null>;

  findCustomer(organizationId: string): Promise<OrganizationCustomerRecord | null>;

  /** Every organization on this install that holds a license, of any kind. */
  findLicensedOrganizationIds(): Promise<string[]>;

  /** Every organization on this install with its stored license, oldest first. */
  findAllOldestFirst(): Promise<{ organizationId: string; license: string | null }[]>;
}
