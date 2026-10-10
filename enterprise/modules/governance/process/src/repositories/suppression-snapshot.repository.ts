// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ErasedIdentifierSuppressionRow } from "./erased-identifier-suppression.repository.ts";
import type { GovernanceTenantRow } from "./governance-tenant-history.repository.ts";

/** The suppression snapshot's two reads, across every organization (ARCHITECTURE §7). */
export abstract class SuppressionSnapshotRepository {
  /** Every erased-identifier digest, deployment-wide. */
  abstract findAllSuppressions(): Promise<ErasedIdentifierSuppressionRow[]>;
  /** Every recorded (organization, tenant) pair, deployment-wide. */
  abstract findAllTenants(): Promise<GovernanceTenantRow[]>;
}
