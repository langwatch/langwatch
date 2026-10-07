/**
 * @vitest-environment node
 * Usage's facts under entitlement's stored names, with every former name upcast (§9).
 * Spec: modules/entitlement/specs/entitlement-stored-names.feature
 */
import {
  type Plan,
  planSchema,
  PricingModel,
  USAGE_LIMIT_CLEARED_EVENT_TYPE,
  USAGE_LIMIT_REACHED_EVENT_TYPE,
  USAGE_MONTH_COUNTED_EVENT_TYPE,
  USAGE_PIPELINE_NAME,
  monthCountedEventDataSchema,
} from "@langwatch/entitlement-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  type Event,
  EventSourcing,
  upcastStepId,
} from "@langwatch/eventing";
import {
  EventStoreMemory,
  InMemoryProcessStore,
  testEventSchema,
} from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { MemoryTraceMeterRepository } from "../../repositories/memory/memory.trace-meter.repository.ts";
import { BillableEventsMeterAppendService } from "../../services/billable-events-meter-append.service.ts";
import { TraceMeterAppendService } from "../../services/trace-meter-append.service.ts";
import { UsageCountingService } from "../../services/usage-counting.service.ts";
import { CountMonthCommand, RecordLimitDecisionCommand } from "../usage.commands.ts";
import { USAGE_AGGREGATE_TYPE } from "../usage.events.ts";
import { buildUsagePipeline } from "../usage.pipeline.ts";

const ORGANIZATION = "org_1";
const OCCURRED_AT = Date.UTC(2026, 9, 15);
const FORMER_TYPES = [
  "lw.usage.month_counted",
  "lw.usage.limit_reached",
  "lw.usage.limit_cleared",
] as const;

const plan: Plan = planSchema.parse({
  planSource: "subscription",
  type: "LAUNCH",
  name: "Launch",
  free: false,
  maxMessagesPerMonth: 1_000,
  maxMembers: 3,
  maxMembersLite: 0,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
});

function metering({ send }: { send?: Parameters<typeof buildUsagePipeline>[0]["send"] } = {}) {
  const projects = { findOrganizationId: async () => ORGANIZATION };
  return buildUsagePipeline({
    countMonth: CountMonthCommand.create({
      counting: UsageCountingService.create({
        meter: MemoryBillableEventsMeterRepository.create(),
        traceMeter: MemoryTraceMeterRepository.create(),
        plans: { getActivePlan: async () => plan },
        billing: { getPricingModel: async () => ({ pricingModel: PricingModel.TIERED }) },
      }),
    }),
    meterStores: send && {
      billableEvents: BillableEventsMeterAppendService.create({
        meter: MemoryBillableEventsMeterRepository.create(),
        projects,
      }),
      traces: TraceMeterAppendService.create({
        meter: MemoryTraceMeterRepository.create(),
        projects,
      }),
    },
    projects,
    send:
      send ??
      (() => {
        throw new Error("nothing is sent from a count");
      }),
  });
}

/** A peer pipeline subscribing to month_counted from its own side, as billing does. */
function peerStandIn(seen: (data: unknown, eventId: string) => void) {
  return definePipeline({
    name: "billing_stand_in",
    aggregate: defineAggregate({ type: "billing_stand_in" }),
  })
    .withEvents([testEventSchema("lw.billing_stand_in.noted", z.object({}))])
    .withPeerSubscriber("usageMonthCounted", {
      eventType: USAGE_MONTH_COUNTED_EVENT_TYPE,
      data: monthCountedEventDataSchema,
      handle: async (data, { eventId }) => seen(data, eventId),
    })
    .build();
}

function runtime(
  seen: (data: unknown, eventId: string) => void,
  send?: Parameters<typeof buildUsagePipeline>[0]["send"],
) {
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  eventing.register(metering({ send }));
  eventing.register(peerStandIn(seen));
  eventing.startConsumers();
  return eventing;
}

/** Sends a job as the previous release queued it, under the key it names. */
async function sendQueued({
  eventing,
  lane,
  pipeline,
  payload,
}: {
  eventing: EventSourcing;
  lane: (key: string) => boolean;
  pipeline?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const key = [...eventing.globalJobRegistry.keys()].find(lane);
  if (!key) throw new Error("no lane matched");
  const [registered, jobType, ...name] = key.split(":");
  await eventing.globalQueue?.send({
    ...payload,
    __pipelineName: pipeline ?? registered,
    __jobType: jobType,
    __jobName: name.join(":"),
  });
}

const counted = {
  organizationId: ORGANIZATION,
  month: "2026-10",
  occurredAt: OCCURRED_AT,
  billableEvents: 12,
  limit: { allowance: 1_000, planName: "Launch", unit: "events" },
};

function storedAsUsage({ id, type }: { id: string; type: string }): Event {
  const decision = { ...counted, count: 12, allowance: 1_000, planName: "Launch", unit: "events" };
  return {
    id,
    aggregateId: ORGANIZATION,
    aggregateType: "usage_organization",
    tenantId: createTenantId(ORGANIZATION),
    type,
    version: "2026-10-01",
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    data: type === "lw.usage.month_counted" ? counted : decision,
  };
}

describe("entitlement's stored names for the usage facts", () => {
  describe("when the metering pipeline is built", () => {
    /** @scenario "Usage's facts are recorded under entitlement's stored names" */
    it("names the pipeline, aggregate, facts and commands after entitlement", () => {
      const definition = metering();

      expect(definition.metadata.name).toBe("entitlement");
      expect(USAGE_PIPELINE_NAME).toBe("entitlement");
      expect(USAGE_AGGREGATE_TYPE).toBe("entitlement_organization");
      expect([
        USAGE_MONTH_COUNTED_EVENT_TYPE,
        USAGE_LIMIT_REACHED_EVENT_TYPE,
        USAGE_LIMIT_CLEARED_EVENT_TYPE,
      ]).toEqual([
        "lw.entitlement.month_counted",
        "lw.entitlement.limit_reached",
        "lw.entitlement.limit_cleared",
      ]);
      expect([CountMonthCommand.schema.type, RecordLimitDecisionCommand.schema.type]).toEqual([
        "lw.entitlement.count_month",
        "lw.entitlement.record_limit_decision",
      ]);
    });
  });

  describe("when the metering pipeline reads a fact stored under its usage name", () => {
    /** @scenario "Each fact stored under its usage name reads as its entitlement fact" */
    it("reads each as its entitlement type on the entitlement aggregate, data unchanged", () => {
      const definition = metering();

      const read = FORMER_TYPES.map((type) =>
        definition.parseEvent(storedAsUsage({ id: type, type })),
      );

      expect(read.map(({ type, aggregateType }) => [type, aggregateType])).toEqual([
        ["lw.entitlement.month_counted", "entitlement_organization"],
        ["lw.entitlement.limit_reached", "entitlement_organization"],
        ["lw.entitlement.limit_cleared", "entitlement_organization"],
      ]);
      expect(read[0]?.data).toEqual(counted);
    });
  });

  describe("when a worker of the new release dequeues a count queued under the usage pipeline", () => {
    /** @scenario "A count the previous release queued under the usage pipeline is still counted" */
    it("counts the month on entitlement's lane and records lw.entitlement.month_counted", async () => {
      const seen = vi.fn();
      const eventing = runtime(seen);

      await sendQueued({
        eventing,
        lane: (key) => key === "entitlement:command:countMonth",
        pipeline: "usage",
        payload: {
          tenantId: ORGANIZATION,
          organizationId: ORGANIZATION,
          month: "2026-10",
          occurredAt: OCCURRED_AT,
        },
      });

      await vi.waitFor(() =>
        expect(seen).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: ORGANIZATION, billableEvents: 0 }),
          expect.any(String),
        ),
      );
      await eventing.close();
    });
  });

  describe("when a peer subscriber's job carries a fact under its usage name", () => {
    /** @scenario "A peer subscriber on month_counted handles a fact queued under its usage name" */
    it("hands the subscriber the counted data once", async () => {
      const seen = vi.fn();
      const eventing = runtime(seen);

      await sendQueued({
        eventing,
        lane: (key) => key.endsWith("billing_stand_in.usageMonthCounted"),
        payload: { ...storedAsUsage({ id: "stored-1", type: "lw.usage.month_counted" }) },
      });

      await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(counted, "stored-1"));
      expect(seen).toHaveBeenCalledTimes(1);
      await eventing.close();
    });
  });

  describe("when a month_counted fact stored under its usage name is delivered after the rename", () => {
    /** @scenario "A stored usage event reads as its entitlement event type" */
    it("the refused-organizations process and billing's subscriber each handle it once", async () => {
      const seen = vi.fn();
      const recordLimitDecision = vi.fn(async () => undefined);
      const eventing = runtime(seen, () => ({ recordLimitDecision, countMonth: vi.fn() }));
      const reached = { ...counted, billableEvents: 1_000 };
      const stored = { ...storedAsUsage({ id: "stored-2", type: "lw.usage.month_counted" }) };

      await sendQueued({
        eventing,
        lane: (key) => key === "entitlement:subscriber:pm:refusedOrganizations",
        pipeline: "usage",
        payload: { ...stored, data: reached },
      });
      await sendQueued({
        eventing,
        lane: (key) => key.endsWith("billing_stand_in.usageMonthCounted"),
        payload: { ...stored, data: reached },
      });

      await vi.waitFor(() =>
        expect(recordLimitDecision).toHaveBeenCalledWith(
          expect.objectContaining({ decision: "reached", count: 1_000 }),
        ),
      );
      await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(reached, "stored-2"));
      expect(recordLimitDecision).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenCalledTimes(1);
      await eventing.close();
    });
  });

  describe("when ops lists the metering pipeline's upcasts", () => {
    /** @scenario "Each usage name is listed for ops as an upcast of the entitlement pipeline" */
    it("lists one upcast per usage name, draining the former usage pipeline", () => {
      const upcasts = metering().upcasts;

      expect(
        upcasts?.events.map(({ from }) =>
          upcastStepId({ pipeline: upcasts.pipeline, from: from.type }),
        ),
      ).toEqual([
        "upcast:entitlement:lw.usage.month_counted",
        "upcast:entitlement:lw.usage.limit_reached",
        "upcast:entitlement:lw.usage.limit_cleared",
      ]);
      expect(upcasts?.drain).toEqual({ pipeline: "usage" });
    });
  });
});
