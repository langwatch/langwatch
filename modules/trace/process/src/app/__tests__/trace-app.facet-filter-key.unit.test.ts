/**
 * The sidebar's facet read on the real `TraceModule` and list service: a repeat
 * shares a count still running only when everything its predicate was built
 * from matches, the viewer's protections and the eval runs included.
 * @see specs/traces-v2/search.feature
 */
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Protections, ResolvedInstantEvalRun, TraceListRead } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const PROJECT_ID = "project-1";
const TIME_RANGE = { from: 1_000, to: 2_000 };

function evalRun(runId: string): ResolvedInstantEvalRun {
  return {
    question: "the user is annoyed",
    target: "traces",
    runId,
    writtenFrom: 900,
    writtenUntil: 2_100,
  };
}

function harness() {
  let scans = 0;
  const repository = createApiFixture<TraceListRead>({
    findBatchedFacets: vi.fn(async () => {
      scans += 1;
      return { categoricals: {}, ranges: {} };
    }),
    findCategoricalFacet: vi.fn(async () => ({ values: [], totalDistinct: 0 })),
    findCategoricalFacetRaw: vi.fn(async () => ({ values: [], totalDistinct: 0 })),
    findRangeStatsForTable: vi.fn(async () => ({ min: 0, max: 0 })),
    findDiscreteValues: vi.fn(async () => ({ values: [], distinctCount: 0 })),
  });
  const list = TraceListService.create({
    discoverUpdates: { publishProjectEvent: async () => {} },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository,
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames: { findNamesByIds: async () => new Map() },
  });
  const findById = vi.fn<ProjectApi["findById"]>(
    async () => ({ id: PROJECT_ID, isPersonal: false }) as Project,
  );
  const app = createTraceAppHarness({
    projects: createApiFixture<ProjectApi>({ findById }, "projects"),
    traces: { list },
  });
  const read = (extra: { protections?: Protections; evalRuns?: ResolvedInstantEvalRun[] }) =>
    app.readFilteredFacets({
      projectId: PROJECT_ID,
      timeRange: TIME_RANGE,
      query: "status:error",
      authorization: ownProof({ projectId: PROJECT_ID }),
      ...extra,
    });
  return { read, scans: () => scans };
}

async function scansPerRun() {
  const once = harness();
  await once.read({});
  return once.scans();
}

describe("TraceModule facet reads arriving together", () => {
  describe("given the same query and window from viewers with different protections", () => {
    /** @scenario "A repeated facet request shares the count still running" */
    it("runs a count for each", async () => {
      const perRun = await scansPerRun();
      const { read, scans } = harness();

      await Promise.all([
        read({ protections: { canSeeCosts: true } }),
        read({ protections: { canSeeCosts: false } }),
      ]);

      expect(scans()).toBe(2 * perRun);
    });
  });

  describe("given the same query and window under different eval runs", () => {
    /** @scenario "A repeated facet request shares the count still running" */
    it("runs a count for each", async () => {
      const perRun = await scansPerRun();
      const { read, scans } = harness();

      await Promise.all([
        read({ evalRuns: [evalRun("run-1")] }),
        read({ evalRuns: [evalRun("run-2")] }),
      ]);

      expect(scans()).toBe(2 * perRun);
    });
  });

  describe("given the same protections and eval runs", () => {
    /** @scenario "A repeated facet request shares the count still running" */
    it("shares one count", async () => {
      const perRun = await scansPerRun();
      const { read, scans } = harness();
      const same = { protections: { canSeeCosts: true }, evalRuns: [evalRun("run-1")] };

      await Promise.all([read(same), read(same)]);

      expect(perRun).toBeGreaterThan(0);
      expect(scans()).toBe(perRun);
    });
  });
});
