import { USAGE_PIPELINE_NAME } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { MemoryTraceCountRepository } from "../../repositories/memory/memory.trace-count.repository.ts";
import type { TenancyRepository } from "../../repositories/tenancy.repository.ts";
import { BillableEventsMeterAppendService } from "../../services/billable-events-meter-append.service.ts";
import { TraceCountStoreService } from "../../services/trace-count-store.service.ts";
import { UsageCountingService } from "../../services/usage-counting.service.ts";
import { BILLABLE_EVENTS_METER_PROJECTION_NAME } from "../billable-events-meter.projection.ts";
import { TRACE_COUNT_PROJECTION_NAME } from "../trace-count.projection.ts";
import { CountMonthCommand } from "../usage.commands.ts";
import { buildUsagePipeline } from "../usage.pipeline.ts";

/** Building asks no peer, so every peer here refuses if it is ever called. */
const refuse = async (): Promise<never> => {
  throw new Error("a peer was asked while the pipeline was only being built");
};

function build({ saas }: { saas: boolean }) {
  const meter = MemoryBillableEventsMeterRepository.create();
  const projects: Pick<TenancyRepository, "getProjectPlacement"> = {
    getProjectPlacement: refuse,
  };
  return buildUsagePipeline({
    countMonth: CountMonthCommand.create({
      counting: UsageCountingService.create({
        meter,
        traceMeter: MemoryTraceCountRepository.create(),
        plans: { getActivePlan: refuse },
        billing: { getPricingModel: refuse },
      }),
    }),
    traceCount: TraceCountStoreService.create({
      counts: MemoryTraceCountRepository.create(),
      projects,
    }),
    billableEventsMeter: saas
      ? BillableEventsMeterAppendService.create({ meter, projects })
      : void 0,
    projects,
    send: () => {
      throw new Error("nothing is sent while the pipeline is only being built");
    },
  });
}

const TRACE_COUNT_LANE = `${USAGE_PIPELINE_NAME}.${TRACE_COUNT_PROJECTION_NAME}`;

describe("usage's pipeline", () => {
  describe("when the usage pipeline registers its global projections", () => {
    /** @scenario "The billable-events meter keeps its lane name" */
    it("registers the billable-events meter as orgBillableEventsMeter", () => {
      expect(BILLABLE_EVENTS_METER_PROJECTION_NAME).toBe("orgBillableEventsMeter");
      expect(build({ saas: true }).globalProjections?.map(({ name }) => name)).toContain(
        "orgBillableEventsMeter",
      );
    });

    /** @scenario "The trace count registers on every deployment, the billable-events meter on SaaS only" */
    it("registers the trace count's peer fold everywhere and the billable-events meter on SaaS only", () => {
      expect(TRACE_COUNT_LANE).toBe("entitlement.usageTraceCount");
      expect(build({ saas: true }).globalProjections?.map(({ name }) => name)).toEqual([
        TRACE_COUNT_LANE,
        "orgBillableEventsMeter",
      ]);
      const selfHosted = build({ saas: false }).globalProjections ?? [];
      expect(selfHosted.map(({ name }) => name)).toEqual([TRACE_COUNT_LANE]);
      expect(selfHosted[0]?.peer?.kind).toBe("fold");
    });
  });
});
