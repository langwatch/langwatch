import { describe, expect, it, vi } from "vitest";
import type { Event } from "@langwatch/eventing";
import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import {
  BILLING_METER_DISPATCH_SUBSCRIBER_NAME,
  BILLING_METER_DISPATCH_SUPPRESS_MS,
  EventingBillingMeterDispatchAdapter,
} from "../eventing.billing-meter-dispatch.adapter";
import { RedisBillingTenantOrganizationCacheAdapter } from "../redis.tenant-organization-cache.adapter";
import { PostgresBillingTenantOrganizationAdapter } from "../postgres.tenant-organization.adapter";
import { BillingTenantOrganizationService } from "../../services/tenant-organization.service";

function compose(
  options: {
    now?: Date;
    project?: { team: { organizationId: string } } | null;
  } = {},
) {
  const dispatched: ReportUsageForMonthCommandData[] = [];
  const findUnique = vi.fn(async () =>
    options.project === undefined ? { team: { organizationId: "org_1" } } : options.project,
  );
  const subscriber = EventingBillingMeterDispatchAdapter.create({
    organizations: BillingTenantOrganizationService.create({
      organizations: PostgresBillingTenantOrganizationAdapter.create({
        database: { project: { findUnique } } as never,
      }).build().organizations,
      cache: RedisBillingTenantOrganizationCacheAdapter.create({
        redis: { get: vi.fn(async () => null), setex: vi.fn(async () => "OK") } as never,
      }),
    }),
    getDispatch: () => async (data) => void dispatched.push(data),
    ...(options.now ? { now: () => options.now as Date } : {}),
  }).build();

  return { subscriber, dispatched };
}

const EVENT = { id: "evt_1", tenantId: "project_alpha" } as unknown as Event;
const CONTEXT = { tenantId: "project_alpha" } as never;

describe("EventingBillingMeterDispatchAdapter", () => {
  describe("given a composed dispatch subscriber", () => {
    /** @scenario "The meter and its dispatch subscriber keep the names both graphs route" */
    it("declares the name, lane, deduplication id and window the App's twin declares", () => {
      const { subscriber } = compose();

      expect(subscriber.name).toBe(BILLING_METER_DISPATCH_SUBSCRIBER_NAME);
      expect(BILLING_METER_DISPATCH_SUBSCRIBER_NAME).toBe("billingMeterDispatch");
      expect(subscriber.options?.groupKeyFn?.({ event: EVENT } as never)).toBe(
        "billing-meter-dispatch:project_alpha",
      );
      expect(subscriber.options?.makeJobId?.({ event: EVENT } as never)).toBe(
        "billing_dispatch_project_alpha",
      );
      expect(subscriber.options?.ttl).toBe(BILLING_METER_DISPATCH_SUPPRESS_MS);
      expect(BILLING_METER_DISPATCH_SUPPRESS_MS).toBe(300_000);
      expect(subscriber.options?.runIn).toEqual(["worker"]);
    });

    /** @scenario "A late-arriving month is reported inside the grace window" */
    it("reports the previous month as well inside the grace window", async () => {
      const { subscriber, dispatched } = compose({ now: new Date("2026-03-03T12:00:00.000Z") });

      await subscriber.handle(EVENT, CONTEXT);

      expect(dispatched.map((data) => data.billingMonth)).toEqual(["2026-02", "2026-03"]);
      expect(dispatched.every((data) => data.organizationId === "org_1")).toBe(true);
      expect(dispatched.every((data) => data.tenantId === "org_1")).toBe(true);
    });

    /** @scenario "A late-arriving month is reported inside the grace window" */
    it("reports the current month only outside that window", async () => {
      const { subscriber, dispatched } = compose({ now: new Date("2026-03-04T00:00:00.000Z") });

      await subscriber.handle(EVENT, CONTEXT);

      expect(dispatched.map((data) => data.billingMonth)).toEqual(["2026-03"]);
    });

    /** @scenario "An orphan project is skipped rather than billed to a neighbour" */
    it("dispatches nothing for a project that belongs to no organization", async () => {
      const { subscriber, dispatched } = compose({ project: null });

      await subscriber.handle(EVENT, CONTEXT);

      expect(dispatched).toEqual([]);
    });
  });
});
