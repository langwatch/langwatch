import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryUsageRepositories } from "../../repositories/memory/memory.usage.repositories.ts";
import { TraceMeterSeedService } from "../trace-meter-seed.service.ts";

const NOW = Date.UTC(2026, 9, 15);
const LAST_MONTH = Date.UTC(2026, 8, 20);

const silent = { info: () => undefined };

function compose() {
  const repositories = MemoryUsageRepositories.create();
  const span = (traceId: string, spanId: string, at: number) =>
    repositories.billableEvents.insert({
      record: {
        organizationId: "org_1",
        tenantId: "project_a",
        eventId: `${traceId}-${spanId}`,
        eventType: SPAN_RECEIVED_EVENT_TYPE,
        deduplicationKey: `project_a:${traceId}:${spanId}`,
        eventTimestamp: at,
      },
      organizationId: "org_1",
    });
  const seed = TraceMeterSeedService.create({
    meter: repositories.traces,
    now: () => NOW,
    logger: silent,
  });
  return { repositories, span, seed };
}

describe("TraceMeterSeedService", () => {
  describe("given traces recorded this month and last month before the trace meter existed", () => {
    describe("when the meter seed runs twice", () => {
      /** @scenario "The meter seed counts each trace once, in its first month" */
      it("counts each trace once, in the month its first span arrived", async () => {
        const { repositories, span, seed } = compose();
        await span("trace_old", "s1", LAST_MONTH);
        await span("trace_old", "s2", NOW);
        await span("trace_new", "s1", NOW);
        await span("trace_new", "s2", NOW);

        await seed.run({ dryRun: false });
        await seed.run({ dryRun: false });

        const read = (month: string) =>
          repositories.traces.findTotal({ organizationId: "org_1", month });
        expect(await read("2026-09")).toBe(1);
        expect(await read("2026-10")).toBe(1);
      });
    });
  });

  describe("given traces recorded this month before the trace meter existed", () => {
    describe("when the meter seed runs as a dry run", () => {
      /** @scenario "A dry run of the meter seed writes nothing" */
      it("reports what it would fold and writes no meter row", async () => {
        const { repositories, span, seed } = compose();
        await span("trace_1", "s1", NOW);

        const summary = await seed.run({ dryRun: true });

        expect(summary.months).toEqual([
          { month: "2026-09", traces: 0 },
          { month: "2026-10", traces: 1 },
        ]);
        expect(
          await repositories.traces.findTotal({ organizationId: "org_1", month: "2026-10" }),
        ).toBe(0);
      });
    });
  });
});
