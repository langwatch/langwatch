import { USAGE_PIPELINE_NAME } from "@langwatch/entitlement-contract";
import { createTenantId, type Event } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { MemoryTraceMeterRepository } from "../../repositories/memory/memory.trace-meter.repository.ts";
import type { TenancyRepository } from "../../repositories/tenancy.repository.ts";
import { BillableEventsMeterAppendService } from "../../services/billable-events-meter-append.service.ts";
import { TraceMeterAppendService } from "../../services/trace-meter-append.service.ts";
import { UsageCountingService } from "../../services/usage-counting.service.ts";
import { BILLABLE_EVENTS_METER_PROJECTION_NAME } from "../billable-events-meter.projection.ts";
import { TRACE_METER_PROJECTION_NAME } from "../trace-meter.projection.ts";
import { CountMonthCommand } from "../usage.commands.ts";
import { buildUsagePipeline } from "../usage.pipeline.ts";

/** Building asks no peer, so every peer here refuses if it is ever called. */
const refuse = async (): Promise<never> => {
  throw new Error("a peer was asked while the pipeline was only being built");
};

function build({
  saas,
  traceMeter = MemoryTraceMeterRepository.create(),
  projects = { getProjectPlacement: refuse },
}: {
  saas: boolean;
  traceMeter?: MemoryTraceMeterRepository;
  projects?: Pick<TenancyRepository, "getProjectPlacement">;
}) {
  const meter = MemoryBillableEventsMeterRepository.create();
  return buildUsagePipeline({
    countMonth: CountMonthCommand.create({
      counting: UsageCountingService.create({
        meter,
        traceMeter: MemoryTraceMeterRepository.create(),
        plans: { getActivePlan: refuse },
        billing: { getPricingModel: refuse },
      }),
    }),
    traceMeter: TraceMeterAppendService.create({ meter: traceMeter, projects }),
    billableEventsMeter: saas
      ? BillableEventsMeterAppendService.create({ meter, projects })
      : void 0,
    projects,
    send: () => {
      throw new Error("nothing is sent while the pipeline is only being built");
    },
  });
}

const TRACE_ID = "aaaa0000000000000000000000000001";
const TRACE_METER_LANE = `${USAGE_PIPELINE_NAME}.${TRACE_METER_PROJECTION_NAME}`;

/** Feeds one span_received through the trace meter peer lane, as the worker does. */
async function meterThroughPeerLane({ data }: { data: unknown }) {
  const traceMeter = MemoryTraceMeterRepository.create();
  const createdAt = Temporal.Instant.from("2026-10-08T12:00:00Z").epochMilliseconds;
  const peer = build({
    saas: false,
    traceMeter,
    projects: {
      getProjectPlacement: async () => ({ kind: "placed" as const, organizationId: "org_1" }),
    },
  }).globalProjections?.find(({ name }) => name === TRACE_METER_LANE)?.peer;
  const event: Event = {
    id: "event_1",
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: createTenantId("project_a"),
    createdAt,
    occurredAt: createdAt,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data,
  };
  expect(peer?.kind).toBe("map");
  if (peer?.kind === "map") {
    await peer.projection.open(async (own, consumes) => {
      if (!consumes(event)) return;
      const record = own.map(event);
      if (record)
        await own.store.append(record, { aggregateId: TRACE_ID, tenantId: event.tenantId });
    });
  }
  return traceMeter.rows;
}

describe("usage's pipeline", () => {
  describe("when the usage pipeline registers its global projections", () => {
    /** @scenario "The billable-events meter keeps its lane name" */
    it("registers the billable-events meter as orgBillableEventsMeter", () => {
      expect(BILLABLE_EVENTS_METER_PROJECTION_NAME).toBe("orgBillableEventsMeter");
      expect(build({ saas: true }).globalProjections?.map(({ name }) => name)).toContain(
        "orgBillableEventsMeter",
      );
    });

    /** @scenario "The trace meter registers on every deployment, the billable-events meter on SaaS only" */
    it("registers the trace meter's peer lane everywhere and the billable-events meter on SaaS only", () => {
      expect(TRACE_METER_PROJECTION_NAME).toBe("usageTraceMeter");
      expect(build({ saas: true }).globalProjections?.map(({ name }) => name)).toEqual([
        TRACE_METER_LANE,
        "orgBillableEventsMeter",
      ]);
      const selfHosted = build({ saas: false }).globalProjections ?? [];
      expect(selfHosted.map(({ name }) => name)).toEqual([TRACE_METER_LANE]);
      expect(selfHosted[0]?.peer?.kind).toBe("map");
    });
  });

  describe("when a span arrives on a self-hosted deployment", () => {
    /** @scenario "A self-hosted deployment appends the trace meter as each trace arrives" */
    it("writes a trace meter row for its trace in the month it arrived", async () => {
      const rows = await meterThroughPeerLane({
        data: {
          span: {
            traceId: TRACE_ID,
            spanId: "bbbb000000000001",
            name: "llm",
            startTimeUnixNano: "1791460800000000000",
            endTimeUnixNano: "1791460801000000000",
          },
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        },
      });

      expect(rows).toEqual([
        { organizationId: "org_1", tenantId: "project_a", traceId: TRACE_ID, month: "2026-10" },
      ]);
    });

    /** @scenario "The trace meter parses only trace's narrow metering schema" */
    it("meters a span whose payload carries only the trace id and start time", async () => {
      const rows = await meterThroughPeerLane({
        data: { span: { traceId: TRACE_ID, startTimeUnixNano: "1791460800000000000" } },
      });

      expect(rows).toEqual([
        { organizationId: "org_1", tenantId: "project_a", traceId: TRACE_ID, month: "2026-10" },
      ]);
    });
  });
});
