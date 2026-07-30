import type { ProcessContext } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  billingMeterPokeIntents,
  billingMeterPokeOn,
  initBillingMeterPokeState,
} from "../billingMeterPoke.process";
import type { BillableEventRecorded } from "../events";
import type { ReportUsagePorts } from "../reportUsage";

const event = (
  overrides: Partial<BillableEventRecorded> = {},
): BillableEventRecorded => ({
  eventId: "event-1",
  eventType: "lw.obs.trace.span_received",
  organizationId: "org-1",
  tenantId: "project-1",
  deduplicationKey: "event-1",
  eventTimestamp: 1_000,
  ...overrides,
});

const ctx = (now: number): ProcessContext => ({
  processKey: "org-1",
  tenantId: "project-1",
  now,
});

describe("billing meter poke process", () => {
  /** @scenario A billable event pokes the usage report for the current month */
  it("dispatches a usage report for the organization's current billing month", () => {
    // Well outside the grace window (day 15), so only the current month pokes.
    const step = billingMeterPokeOn.billableEventRecorded!(
      initBillingMeterPokeState(),
      event(),
      ctx(Date.UTC(2026, 6, 15)),
    );

    expect(step.intents).toEqual([
      {
        type: "reportUsage",
        payload: {
          organizationId: "org-1",
          billingMonth: "2026-07",
          tenantId: "project-1",
          occurredAt: Date.UTC(2026, 6, 15),
        },
      },
    ]);
    expect(step.nextWakeAt).toBeNull();
  });

  /** @scenario Late events inside the grace window still reach the previous month */
  it("also dispatches the previous month's report inside the grace window", () => {
    const step = billingMeterPokeOn.billableEventRecorded!(
      initBillingMeterPokeState(),
      event(),
      ctx(Date.UTC(2026, 6, 2)),
    );

    expect(step.intents.map((intent) => intent.payload.billingMonth)).toEqual([
      "2026-06",
      "2026-07",
    ]);
  });

  it("dispatches only the current month once the grace window has closed", () => {
    const step = billingMeterPokeOn.billableEventRecorded!(
      initBillingMeterPokeState(),
      event(),
      ctx(Date.UTC(2026, 6, 4)),
    );

    expect(step.intents.map((intent) => intent.payload.billingMonth)).toEqual([
      "2026-07",
    ]);
  });

  describe("given the same organization pokes twice in the same billing month", () => {
    /** @scenario Rapid billable events collapse onto one usage report */
    it("computes the identical message key, so a redelivery collapses", async () => {
      const { billingMeterPokeIntents } = await import(
        "../billingMeterPoke.process"
      );
      const intents = billingMeterPokeIntents({
        organizations: { getOrganizationForBilling: async () => undefined },
        organizationCache: {
          get: async () => undefined,
          set: async () => undefined,
        },
        billingCheckpoints: {} as never,
        getUsageReportingService: () => undefined,
        queryBillableEventsTotal: async () => null,
      });

      const first = intents.reportUsage.messageKey({
        organizationId: "org-1",
        billingMonth: "2026-07",
        tenantId: "project-1",
        occurredAt: 1,
      });
      const second = intents.reportUsage.messageKey({
        organizationId: "org-1",
        billingMonth: "2026-07",
        tenantId: "project-1",
        occurredAt: 2,
      });

      expect(second).toBe(first);
    });
  });

  describe("given the usage report dispatch fails", () => {
    /** @scenario A dispatch that fails is raised, not swallowed */
    it("raises rather than logging and discarding the failure", async () => {
      const ports: ReportUsagePorts = {
        organizations: {
          getOrganizationForBilling: vi
            .fn()
            .mockRejectedValue(new Error("db down")),
        },
        organizationCache: {
          get: async () => undefined,
          set: async () => undefined,
        },
        billingCheckpoints: {} as never,
        getUsageReportingService: () => undefined,
        queryBillableEventsTotal: async () => null,
      };
      const intents = billingMeterPokeIntents(ports);

      await expect(
        intents.reportUsage.deliver(
          {
            organizationId: "org-1",
            billingMonth: "2026-07",
            tenantId: "project-1",
            occurredAt: 1,
          },
          { now: 1, tenantId: "project-1" },
        ),
      ).rejects.toThrow("db down");
    });
  });
});
