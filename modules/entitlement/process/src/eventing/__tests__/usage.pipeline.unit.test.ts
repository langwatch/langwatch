import { USAGE_PIPELINE_NAME } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { MemoryTraceCountRepository } from "../../repositories/memory/memory.trace-count.repository.ts";
import type { TenancyRepository } from "../../repositories/tenancy.repository.ts";
import { BillableEventsMeterAppendService } from "../../services/billable-events-meter-append.service.ts";
import { TraceUsageService } from "../../services/trace-usage.service.ts";
import { UsageCountingService } from "../../services/usage-counting.service.ts";
import { BILLABLE_EVENTS_METER_PROJECTION_NAME } from "../billable-events-meter.projection.ts";
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
    traceUsage: TraceUsageService.create({
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

const TRACE_USAGE_LANES = [
  `${USAGE_PIPELINE_NAME}.traceUsageSpan`,
  `${USAGE_PIPELINE_NAME}.traceUsageMonthIds`,
];

describe("usage's pipeline", () => {
  describe("when the usage pipeline registers its global projections", () => {
    /** @scenario "The billable-events meter keeps its lane name" */
    it("registers the billable-events meter as orgBillableEventsMeter", () => {
      expect(BILLABLE_EVENTS_METER_PROJECTION_NAME).toBe("orgBillableEventsMeter");
      expect(build({ saas: true }).globalProjections?.map(({ name }) => name)).toContain(
        "orgBillableEventsMeter",
      );
    });

    /** @scenario "Trace usage registers on every deployment, the billable-events meter on SaaS only" */
    it("registers the trace usage subscribers everywhere and the billable-events meter on SaaS only", () => {
      expect(build({ saas: true }).globalProjections?.map(({ name }) => name)).toEqual([
        ...TRACE_USAGE_LANES,
        "orgBillableEventsMeter",
      ]);
      const selfHosted = build({ saas: false }).globalProjections ?? [];
      expect(selfHosted.map(({ name }) => name)).toEqual(TRACE_USAGE_LANES);
    });
  });
});
