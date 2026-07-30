import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import { describe, expect, it, vi } from "vitest";
import { BILLING_METER_POKE_PROCESS_NAME } from "../billingMeterPoke.process";
import { BILLING_METER_SWEEP_PROCESS_NAME } from "../billingMeterSweep.process";
import { type BillingReportingPipelineDeps, createBillingReportingPipeline } from "../index";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function fakeClient(): ClickHouseClient {
  return {
    async query(): Promise<{ rows: unknown[][] }> {
      throw new Error("not used by an append store");
    },
    stream(_options: QueryOptions) {
      throw new Error("not used by an append store");
    },
    async insert() {},
    async close() {},
  };
}

function stubDeps(overrides: Partial<BillingReportingPipelineDeps> = {}): BillingReportingPipelineDeps {
  return {
    client: fakeClient(),
    organizations: { getOrganizationForBilling: vi.fn() },
    billingCheckpoints: {} as never,
    getUsageReportingService: () => undefined,
    queryBillableEventsTotal: vi.fn(),
    listOrganizationsToReport: vi.fn().mockResolvedValue([]),
    pruneDispatchedIntentsBefore: vi.fn(),
    resolveOrganizationId: vi.fn(),
    isSaas: true,
    ...overrides,
  };
}

describe("billing-reporting pipeline topology", () => {
  it("names itself 'billing_report'", () => {
    const built = createBillingReportingPipeline(stubDeps());
    expect(built.name).toBe("billing_report");
  });

  it("derives the dotted event type string", () => {
    const built = createBillingReportingPipeline(stubDeps());
    expect(built.eventTypes).toEqual(["lw.billing_report.billable_event_recorded"]);
  });

  it("mounts the command bridge, the meter, and both process managers", () => {
    const built = createBillingReportingPipeline(stubDeps());

    expect(Object.keys(built.commands)).toEqual(["recordBillableEvent"]);
    expect(Object.keys(built.maps)).toEqual(["billableEventsMeter"]);
    expect(Object.keys(built.processManagers).sort()).toEqual(
      [BILLING_METER_POKE_PROCESS_NAME, BILLING_METER_SWEEP_PROCESS_NAME].sort(),
    );
  });

  /** @scenario Self-hosted builds never poke the usage meter */
  it("mounts the poke disabled on a self-hosted build", () => {
    const built = createBillingReportingPipeline(stubDeps({ isSaas: false }));
    expect(built.processManagers[BILLING_METER_POKE_PROCESS_NAME]!.enabled).toBe(false);
  });

  it("mounts the poke enabled on a SaaS build", () => {
    const built = createBillingReportingPipeline(stubDeps({ isSaas: true }));
    expect(built.processManagers[BILLING_METER_POKE_PROCESS_NAME]!.enabled).toBe(true);
  });

  it("is asserted at composition rather than on the first delivery", () => {
    expect(() => createBillingReportingPipeline(stubDeps())).not.toThrow();
  });
});
