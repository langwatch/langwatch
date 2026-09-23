import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import { EventSchema } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { TenantOrganizationRepository } from "../../repositories/tenant-organization.repository.ts";
import {
  BillingTenantOrganizationService,
  type BillingTenantOrganizationCache,
} from "../../services/tenant-organization.service.ts";
import { BillingMeterDispatchSubscriber } from "../billing-meter-dispatch.subscriber.ts";

class OneOrganization extends TenantOrganizationRepository {
  async findOrganizationForTenant(): Promise<string | null> {
    return "org_1";
  }
}

class EmptyCache implements BillingTenantOrganizationCache {
  async find(): Promise<string | undefined> {
    return undefined;
  }

  async set(): Promise<void> {}
}

const meteredEvent = EventSchema.parse({
  id: "evt_1",
  aggregateId: "trace_1",
  aggregateType: "trace",
  tenantId: "project_alpha",
  createdAt: 1_772_539_200_000,
  occurredAt: 1_772_539_200_000,
  type: "lw.obs.trace.span_received",
  version: "2026-01-01",
  data: {},
});

describe("BillingMeterDispatchSubscriber redelivery", () => {
  it("dispatches the same monthly reporting identity when one event is handled twice", async () => {
    // The reporting command collapses on `${organizationId}:${billingMonth}`,
    // its deduplication id in billing-reporting.pipeline.ts.
    const pendingReports = new Map<string, ReportUsageForMonthCommandData>();
    const subscriber = BillingMeterDispatchSubscriber.create({
      organizations: BillingTenantOrganizationService.create({
        organizations: new OneOrganization(),
        cache: new EmptyCache(),
      }),
      getDispatch: () => async (data) => {
        pendingReports.set(`${data.organizationId}:${data.billingMonth}`, data);
      },
      now: () => Temporal.Instant.from("2026-03-03T12:00:00.000Z"),
    }).build();
    const context = { tenantId: "project_alpha", aggregateId: "trace_1", foldState: undefined };

    await subscriber.handle(meteredEvent, context);
    await subscriber.handle(meteredEvent, context);

    expect([...pendingReports.keys()]).toEqual(["org_1:2026-02", "org_1:2026-03"]);
  });
});
