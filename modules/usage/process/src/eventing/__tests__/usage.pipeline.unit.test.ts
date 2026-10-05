import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { BillableEventsMeterAppendService } from "../../services/billable-events-meter-append.service.ts";
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
  const projects = { findOrganizationId: refuse };
  return buildUsagePipeline({
    countMonth: CountMonthCommand.create({
      counting: UsageCountingService.create({
        meter,
        entitlement: { getActivePlan: refuse },
        billing: { getPricingModel: refuse },
      }),
    }),
    meterStore: saas ? BillableEventsMeterAppendService.create({ meter, projects }) : void 0,
    projects,
    send: () => {
      throw new Error("nothing is sent while the pipeline is only being built");
    },
  });
}

describe("usage's pipeline", () => {
  describe("when the usage pipeline registers its global projections", () => {
    /** @scenario "The billable-events meter keeps its lane name" */
    it("registers the billable-events meter as orgBillableEventsMeter", () => {
      expect(BILLABLE_EVENTS_METER_PROJECTION_NAME).toBe("orgBillableEventsMeter");
      expect(build({ saas: true }).globalProjections?.map(({ name }) => name)).toEqual([
        "orgBillableEventsMeter",
      ]);
    });

    it("registers no meter on a self-hosted deployment", () => {
      expect(build({ saas: false }).globalProjections ?? []).toEqual([]);
    });
  });
});
