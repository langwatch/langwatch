// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { BillingTenantOrganizationPort } from "../ports/tenant-organization.port";

const logger = createLogger("langwatch:billing:tenantOrganization");

/**
 * The shared read-through store for tenant attribution.
 *
 * Structural, and deliberately narrow: the process owns whether this is
 * Redis-backed (one keyspace across every pod and every graph in the fleet) or
 * in-memory, and this service only ever reads and writes one key per tenant.
 */
export interface BillingTenantOrganizationCache {
  get(tenantId: string): Promise<string | undefined>;
  set(tenantId: string, organizationId: string): Promise<void>;
}

/**
 * Attributes a billable event's tenant to the organization it is billed to.
 *
 * Read-through rather than write-through, and the negative is deliberately not
 * cached: a project that has no organization yet is a different thing from one
 * that never will, and remembering the miss would leave a newly created
 * project unattributed until the entry expired — every one of its events
 * skipped and never counted, with nothing to notice.
 */
export class BillingTenantOrganizationService {
  static create(deps: {
    organizations: BillingTenantOrganizationPort;
    cache: BillingTenantOrganizationCache;
  }): BillingTenantOrganizationService {
    return new BillingTenantOrganizationService(deps.organizations, deps.cache);
  }

  private constructor(
    private readonly organizations: BillingTenantOrganizationPort,
    private readonly cache: BillingTenantOrganizationCache,
  ) {}

  /** Undefined means an orphan tenant, which is skipped rather than billed. */
  async tryResolveOrganizationId(tenantId: string): Promise<string | undefined> {
    const cached = await this.cache.get(tenantId);

    if (cached) {
      return cached;
    }

    const organizationId = await this.organizations.tryFindOrganizationForTenant(tenantId);

    if (!organizationId) {
      logger.warn(
        { projectId: tenantId },
        "orphan project detected, has no organization -- skipping billing attribution",
      );

      return undefined;
    }

    await this.cache.set(tenantId, organizationId);

    return organizationId;
  }
}
