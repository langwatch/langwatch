import {
  type MonthCountedEventData,
  type Plan,
  planSchema,
  PricingModel,
} from "@langwatch/entitlement-contract";
import { EVALUATION_EVENT_TYPES } from "@langwatch/evaluation-contract";
import { createTenantId, type Event, EventUtils } from "@langwatch/eventing";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { BillableEventsMeterProjection } from "../../eventing/billable-events-meter.projection.ts";
import { BillableEventsMeterRepository } from "../../repositories/billable-events-meter.repository.ts";
import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { MemoryTraceMeterRepository } from "../../repositories/memory/memory.trace-meter.repository.ts";
import { decideLimit } from "../../rules/usage-limit.rules.ts";
import { BillableEventsMeterAppendService } from "../billable-events-meter-append.service.ts";
import { UsageCountingService } from "../usage-counting.service.ts";

const ORGANIZATION = "org_1";
const MONTH = "2026-10";
const OCCURRED_AT = Date.UTC(2026, 9, 15);

function plan({ allowance }: { allowance: number }): Plan {
  return planSchema.parse({
    planSource: "subscription",
    type: "LAUNCH",
    name: "Launch",
    free: false,
    maxMessagesPerMonth: allowance,
    maxMembers: 3,
    maxMembersLite: 0,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  });
}

/** A trace meter that counts how often it is read, over the memory twin. */
class ReadCountingTraceMeter extends MemoryTraceMeterRepository {
  reads = 0;

  constructor() {
    super();
  }

  override async findTotal(input: { organizationId: string; month: string }): Promise<number> {
    this.reads += 1;
    return super.findTotal(input);
  }
}

/** Records each warning as the pino call shape `(fields, message)`. */
class WarningLog {
  readonly lines: { fields: unknown; message: unknown }[] = [];

  warn(fields: unknown, message?: unknown): void {
    this.lines.push({ fields, message });
  }
}

/** A billable-events store that cannot answer. */
class UnreachableMeter extends BillableEventsMeterRepository {
  async insert(): Promise<void> {}

  async findTotal(): Promise<number> {
    throw new Error("ClickHouse is unreachable");
  }

  async countByProjects(): Promise<never> {
    throw new Error("ClickHouse is unreachable");
  }
}

function compose({
  allowance,
  pricingModel,
  meter = MemoryBillableEventsMeterRepository.create(),
}: {
  allowance: number;
  pricingModel: PricingModel;
  meter?: BillableEventsMeterRepository;
}) {
  const traceMeter = new ReadCountingTraceMeter();
  const log = new WarningLog();
  for (const traceId of ["t1", "t2", "t3"]) {
    void traceMeter.insert({
      record: { organizationId: ORGANIZATION, tenantId: "project_a", traceId, month: MONTH },
      organizationId: ORGANIZATION,
    });
  }
  const counting = UsageCountingService.create({
    meter,
    traceMeter,
    plans: { getActivePlan: async () => plan({ allowance }) },
    billing: { getPricingModel: async () => ({ pricingModel }) },
    logger: log,
  });
  const countMonth = () =>
    counting.countMonth({ organizationId: ORGANIZATION, month: MONTH, occurredAt: OCCURRED_AT });
  return { traceMeter, log, countMonth };
}

const decide = (counted: MonthCountedEventData) =>
  decideLimit({ state: { month: null, reached: false }, counted }).decision;

describe("UsageCountingService", () => {
  describe("given an organization on seat-and-event pricing", () => {
    describe("when usage counts the organization's month", () => {
      /** @scenario "The plan chooses the meter" */
      it("reads the billable-events meter and not the trace meter", async () => {
        const { traceMeter, countMonth } = compose({
          allowance: 1_000,
          pricingModel: PricingModel.SEAT_EVENT,
        });

        const counted = await countMonth();

        expect(traceMeter.reads).toBe(0);
        expect(counted).toMatchObject({ billableEvents: 0, limit: { unit: "events" } });
        expect(counted.traces).toBeUndefined();
      });
    });
  });

  describe("given an organization on tiered pricing whose month's traces reach its allowance", () => {
    describe("when usage counts the organization's month", () => {
      /** @scenario "A trace-metered organization past its allowance records the limit as reached" */
      it("reads the trace meter and decides the limit reached", async () => {
        const { traceMeter, countMonth } = compose({
          allowance: 3,
          pricingModel: PricingModel.TIERED,
        });

        const counted = await countMonth();

        expect(traceMeter.reads).toBe(1);
        expect(counted).toMatchObject({ traces: 3, limit: { unit: "traces", allowance: 3 } });
        expect(decide(counted)).toBe("reached");
      });
    });
  });

  describe("given the organization's plan caps nothing", () => {
    describe("when usage counts the organization's month", () => {
      /** @scenario "An unlimited plan is never counted for enforcement" */
      it("does not read the trace meter and decides nothing", async () => {
        const { traceMeter, countMonth } = compose({
          allowance: 999_999_999,
          pricingModel: PricingModel.TIERED,
        });

        const counted = await countMonth();

        expect(traceMeter.reads).toBe(0);
        expect(decide(counted)).toBe("none");
      });
    });
  });

  describe("given the meter's store cannot be read", () => {
    describe("when usage counts the organization's month", () => {
      /** @scenario "A count the meter cannot answer decides nothing" */
      it("throws, so nothing is decided, and logs a warning naming the organization and plan", async () => {
        const { log, countMonth } = compose({
          allowance: 1_000,
          pricingModel: PricingModel.SEAT_EVENT,
          meter: new UnreachableMeter(),
        });

        await expect(countMonth()).rejects.toThrow("ClickHouse is unreachable");
        expect(log.lines).toEqual([
          {
            fields: expect.objectContaining({ organizationId: ORGANIZATION, plan: "Launch" }),
            message: expect.stringContaining("cannot be read"),
          },
        ]);
      });
    });
  });

  describe("given spans, evaluations, experiment results and simulation messages this month", () => {
    describe("when the month's count is read for the project's organization", () => {
      /** @scenario "Entitlement counts billable events from every pipeline itself" */
      it("counts them from usage's own meter, asking no peer to count", async () => {
        const meter = MemoryBillableEventsMeterRepository.create();
        const append = BillableEventsMeterAppendService.create({
          meter,
          projects: { findOrganizationId: async () => ORGANIZATION },
        });
        const projection = BillableEventsMeterProjection.create(append).build();
        const types = [
          SPAN_RECEIVED_EVENT_TYPE,
          EVALUATION_EVENT_TYPES.REPORTED,
          "lw.experiment_run.target_result",
          SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
        ];
        const events: Event[] = types.map((type, index) =>
          EventUtils.createEvent<Event>({
            aggregateType: "trace",
            aggregateId: `aggregate_${index}`,
            tenantId: createTenantId("project_a"),
            type,
            version: "2026-10-01",
            data: {},
            metadata: {},
            occurredAt: OCCURRED_AT,
          }),
        );
        for (const event of events) {
          const record = projection.map(event);
          if (record) await append.append(record);
        }
        const counting = UsageCountingService.create({
          meter,
          traceMeter: new ReadCountingTraceMeter(),
          plans: { getActivePlan: async () => plan({ allowance: 1_000 }) },
          billing: { getPricingModel: async () => ({ pricingModel: PricingModel.SEAT_EVENT }) },
        });

        const counted = await counting.countMonth({
          organizationId: ORGANIZATION,
          month: UsageCountingService.monthOf(events[0]!.createdAt),
          occurredAt: OCCURRED_AT,
        });

        expect(projection.eventTypes).toEqual(expect.arrayContaining(types));
        expect(counted.billableEvents).toBe(types.length);
      });
    });
  });
});
