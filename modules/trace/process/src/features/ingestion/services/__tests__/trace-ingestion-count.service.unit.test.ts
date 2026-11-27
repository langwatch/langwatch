/** Spec: modules/trace/specs/trace-ops-reads.feature */
import { describe, expect, it } from "vitest";

import { MemoryTracePlanLimitRefusalsRepository } from "../../../../repositories/memory/memory.trace-plan-limit-refusals.repository.ts";
import type { TraceProjectCount } from "../../../../repositories/trace-existence.repository.ts";
import { TraceIngestionCountService } from "../trace-ingestion-count.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const day0 = Date.UTC(2026, 10, 20);

function serviceWith({
  traces,
  refusals,
}: {
  traces: TraceProjectCount[];
  refusals: MemoryTracePlanLimitRefusalsRepository;
}) {
  return TraceIngestionCountService.create({
    existence: {
      countTracesByProject: async ({ projectIds }) =>
        traces.filter((row) => projectIds.includes(row.projectId)),
    },
    refusals,
  });
}

describe("TraceIngestionCountService", () => {
  describe("given traces and plan-limit refusals for some of the asked projects", () => {
    /** @scenario Every asked project gets a row with its refusals, in the order asked */
    it("answers one row per asked project, in the order asked, with its traces and refusals", async () => {
      const refusals = MemoryTracePlanLimitRefusalsRepository.create();
      await refusals.recordRefusal({ projectId: "p2", dayStartMs: day0 });
      await refusals.recordRefusal({ projectId: "p2", dayStartMs: day0 + DAY_MS });
      // Outside the range: the day after `until`.
      await refusals.recordRefusal({ projectId: "p2", dayStartMs: day0 + 2 * DAY_MS });
      const service = serviceWith({
        traces: [{ projectId: "p1", traces: 4, lastTraceAt: day0 + 1_000 }],
        refusals,
      });

      const rows = await service.countIngestionByProject({
        projectIds: ["p2", "p1", "p3", "p2"],
        since: day0 + 60_000,
        until: day0 + 2 * DAY_MS,
      });

      expect(rows).toEqual([
        { projectId: "p2", traces: 0, lastTraceAt: null, planLimitRefusals: 2 },
        { projectId: "p1", traces: 4, lastTraceAt: day0 + 1_000, planLimitRefusals: 0 },
        { projectId: "p3", traces: 0, lastTraceAt: null, planLimitRefusals: 0 },
      ]);
    });

    /** @scenario Every asked project gets a row with its refusals, in the order asked */
    it("counts nothing over an empty range", async () => {
      const refusals = MemoryTracePlanLimitRefusalsRepository.create();
      await refusals.recordRefusal({ projectId: "p1", dayStartMs: day0 });
      const service = serviceWith({
        traces: [{ projectId: "p1", traces: 4, lastTraceAt: day0 }],
        refusals,
      });

      const rows = await service.countIngestionByProject({
        projectIds: ["p1"],
        since: day0 + DAY_MS,
        until: day0,
      });

      expect(rows).toEqual([
        { projectId: "p1", traces: 0, lastTraceAt: null, planLimitRefusals: 0 },
      ]);
    });
  });
});
