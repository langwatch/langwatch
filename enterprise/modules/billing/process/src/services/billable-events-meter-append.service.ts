// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AppendStore } from "@langwatch/eventing";

import type {
  BillableEventRecord,
  BillableEventsMeterRepository,
} from "../repositories/billable-events-meter.repository.ts";
import type { BillingTenantOrganizationService } from "./tenant-organization.service.ts";

/**
 * The meter projection's append side. A failed insert throws so the queue
 * redelivers it: a redelivered row collapses on read by its deduplication key,
 * while a swallowed one is revenue never counted.
 */
export class BillableEventsMeterAppendService implements AppendStore<BillableEventRecord> {
  private constructor(
    private readonly meter: BillableEventsMeterRepository,
    private readonly organizations: BillingTenantOrganizationService,
  ) {}

  static create(options: {
    meter: BillableEventsMeterRepository;
    organizations: BillingTenantOrganizationService;
  }): BillableEventsMeterAppendService {
    return new BillableEventsMeterAppendService(options.meter, options.organizations);
  }

  async append(record: BillableEventRecord): Promise<void> {
    const organizationId = await this.organizations.findOrganizationId(record.tenantId);
    if (!organizationId) return;

    await this.meter.insert({ record, organizationId });
  }
}
