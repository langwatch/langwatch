// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** One `TenantId` an organization has written governance rows under. */
export interface GovernanceTenantRow {
  organizationId: string;
  tenantId: string;
}

/** Every tenant an organization ever used — erasure walks all of them (ADR-128 §11). */
export abstract class GovernanceTenantHistoryRepository {
  /** Oldest first: personal data does not stop existing in a tenant that stopped being current. */
  abstract findAllByOrganization(input: { organizationId: string }): Promise<GovernanceTenantRow[]>;
  /** Every recorded (organization, tenant) pair — the suppression snapshot's read. */
  abstract findAll(): Promise<GovernanceTenantRow[]>;
  /** Moves `lastUsedAt` forward on a recorded tenant; false is the caller's signal to append. */
  abstract touch(input: {
    organizationId: string;
    tenantId: string;
    at: Instant;
  }): Promise<boolean>;
  /** Records a tenant on first use; a concurrent duplicate is the normal case, not an error. */
  abstract append(input: { organizationId: string; tenantId: string; at: Instant }): Promise<void>;
}
