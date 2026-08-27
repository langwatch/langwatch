/**
 * The atom read, against real ClickHouse.
 *
 * @see specs/features/agent-testing/results-atoms.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResilientClickHouseClient } from "~/server/clickhouse/managedClient";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import type { ResultsFilter } from "../atom.types";
import { ResultAtomsClickHouseRepository } from "../result-atoms.clickhouse.repository";

const tenantId = `test-atoms-${nanoid()}`;
const otherTenantId = `${tenantId}-other`;
const now = Date.now();
const windowStart = now - 7 * 24 * 60 * 60 * 1000;

function makeRow({
  scenarioId = `scen-${nanoid(6)}`,
  scenarioRunId = `run-${nanoid(10)}`,
  batchRunId,
  scenarioSetId,
  status = "SUCCESS",
  startedAt = new Date(now - 60_000),
  updatedAt,
  tenant = tenantId,
  totalCost = null,
  traceIds = [],
  traceMetricsJson = "",
  targetReferenceId,
  note,
  archivedAt = null,
  durationMs = "1500",
}: {
  scenarioId?: string;
  scenarioRunId?: string;
  batchRunId: string;
  scenarioSetId: string;
  status?: string;
  startedAt?: Date;
  updatedAt?: Date;
  tenant?: string;
  totalCost?: number | null;
  traceIds?: string[];
  traceMetricsJson?: string;
  targetReferenceId?: string;
  note?: string;
  archivedAt?: Date | null;
  durationMs?: string | null;
}) {
  const metadata: Record<string, unknown> = {};
  if (targetReferenceId) metadata.langwatch = { targetReferenceId };
  if (note) metadata.note = note;

  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    ScenarioRunId: scenarioRunId,
    ScenarioId: scenarioId,
    BatchRunId: batchRunId,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: status,
    Name: "Refund Flow",
    Description: null,
    Metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: traceIds,
    Verdict: status === "SUCCESS" ? "success" : "failure",
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: durationMs,
    TotalCost: totalCost,
    TraceMetricsJson: traceMetricsJson,
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: updatedAt ?? new Date(startedAt.getTime() + 1000),
    FinishedAt: new Date(startedAt.getTime() + 1000),
    ArchivedAt: archivedAt,
    LastSnapshotOccurredAt: new Date(0),
  };
}

let ch: ClickHouseClient;
let repo: ResultAtomsClickHouseRepository;

async function insertRows(rows: ReturnType<typeof makeRow>[]) {
  await ch.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const baseFilter = (over: Partial<ResultsFilter> = {}): ResultsFilter => ({
  projectId: tenantId,
  startDate: windowStart,
  ...over,
});

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repo = new ResultAtomsClickHouseRepository(async () => resilient);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const tenant of [tenantId, otherTenantId]) {
      await ch.exec({
        query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: tenant },
      });
    }
  }
  await stopTestContainers();
});

describe("findAtoms", () => {
  describe("given one run of one scenario against one target", () => {
    /** @scenario "An atom names its plan, its run and its scenario" */
    /** @scenario "An atom carries the target the run was pointed at" */
    /** @scenario "A run started on the platform reads as started in the app" */
    /** @scenario "An atom carries the note of its run" */
    it("names the plan, the run, the scenario, the target, the trigger and the note", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      const scenarioId = `scen-${nanoid(6)}`;
      await insertRows([
        makeRow({
          scenarioId,
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
          note: "stricter judge",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]).toMatchObject({
        SetId: setId,
        BatchRunId: batchRunId,
        ScenarioId: scenarioId,
        TargetKey: "agent_dev",
        Trigger: "app",
        Note: "stricter judge",
        Outcome: "passed",
      });
    });
  });

  describe("given a run pushed from code with no platform target", () => {
    /** @scenario "A run pushed from code carries no target" */
    /** @scenario "A run pushed from code reads as started from code" */
    it("reads the target as unknown and the trigger as code", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({ batchRunId: `batch-${nanoid(6)}`, scenarioSetId: setId }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.TargetKey).toBe("unknown");
      expect(atoms[0]?.Trigger).toBe("code");
    });
  });

  describe("given one run of two scenarios against two targets", () => {
    /** @scenario "One run against two targets gives one atom per target" */
    it("returns one atom per scenario and target pair, all on the same run", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      const scenarioA = `scen-${nanoid(6)}`;
      const scenarioB = `scen-${nanoid(6)}`;
      await insertRows(
        ["agent_dev", "agent_prod"].flatMap((target) =>
          [scenarioA, scenarioB].map((scenarioId) =>
            makeRow({
              scenarioId,
              batchRunId,
              scenarioSetId: setId,
              targetReferenceId: target,
            }),
          ),
        ),
      );

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(4);
      expect(new Set(atoms.map((atom) => atom.BatchRunId))).toEqual(
        new Set([batchRunId]),
      );
      expect(new Set(atoms.map((atom) => atom.TargetKey))).toEqual(
        new Set(["agent_dev", "agent_prod"]),
      );
    });
  });

  describe("given a run written twice", () => {
    /** @scenario "An atom reads the latest version of its run" */
    it("reads the latest version and returns one atom, not two", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      const scenarioRunId = `run-${nanoid(10)}`;
      const startedAt = new Date(now - 60_000);
      await insertRows([
        makeRow({
          scenarioRunId,
          batchRunId,
          scenarioSetId: setId,
          status: "IN_PROGRESS",
          startedAt,
          updatedAt: new Date(now - 50_000),
        }),
        makeRow({
          scenarioRunId,
          batchRunId,
          scenarioSetId: setId,
          status: "SUCCESS",
          startedAt,
          updatedAt: new Date(now - 40_000),
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.Outcome).toBe("passed");
    });
  });

  describe("given an archived run", () => {
    /** @scenario "An archived run is left out" */
    it("leaves it out", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          archivedAt: new Date(now),
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(0);
    });
  });

  describe("given two projects holding a run of the same id", () => {
    /** @scenario "Atoms never cross a project" */
    it("returns only the run of the project asked for", async () => {
      const setId = `set-${nanoid(6)}`;
      const scenarioRunId = `run-${nanoid(10)}`;
      await insertRows([
        makeRow({
          scenarioRunId,
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "mine",
        }),
        makeRow({
          scenarioRunId,
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          tenant: otherTenantId,
          targetReferenceId: "theirs",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.TargetKey).toBe("mine");
    });
  });

  describe("when the filter names an empty list of scenarios", () => {
    /** @scenario "A filter with an empty list of scenarios returns nothing" */
    it("returns nothing without sending a query", async () => {
      const failing = new ResultAtomsClickHouseRepository(async () => {
        throw new Error("no query should be sent for an empty scope");
      });

      await expect(
        failing.findAtoms({
          filter: baseFilter({ scenarioIds: [] }),
          limit: 10,
        }),
      ).resolves.toEqual({ atoms: [], hasMore: false });
    });
  });

  describe("when more atoms exist than one page holds", () => {
    /** @scenario "The atom list pages and says when more remain" */
    /** @scenario "The next page carries on where the first stopped" */
    it("pages without repeating or dropping an atom", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      await insertRows(
        Array.from({ length: 5 }, (_, index) =>
          makeRow({
            batchRunId,
            scenarioSetId: setId,
            startedAt: new Date(now - (index + 1) * 60_000),
          }),
        ),
      );

      const first = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 2,
      });
      expect(first.atoms).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeDefined();

      const second = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
        cursor: first.nextCursor,
      });

      const firstIds = first.atoms.map((atom) => atom.ScenarioRunId);
      const secondIds = second.atoms.map((atom) => atom.ScenarioRunId);
      expect(secondIds).toHaveLength(3);
      expect(new Set([...firstIds, ...secondIds]).size).toBe(5);
    });
  });
});

describe("the cost of an atom", () => {
  describe("given a run with a stored total", () => {
    /** @scenario "An atom takes its cost from the stored total of its run" */
    it("takes the stored total and names the run as its source", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          totalCost: 0.042,
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.CostUsd).toBe("0.042");
      expect(atoms[0]?.CostSource).toBe("run");
    });
  });

  describe("given a run with per trace costs but no stored total", () => {
    /** @scenario "An atom with no stored total takes its cost from its traces" */
    it("sums the traces and names them as its source", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          totalCost: null,
          traceIds: ["t1", "t2"],
          traceMetricsJson: JSON.stringify({
            t1: { totalCost: 0.01 },
            t2: { totalCost: 0.02 },
          }),
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(Number(atoms[0]?.CostUsd)).toBeCloseTo(0.03, 6);
      expect(atoms[0]?.CostSource).toBe("traces");
    });
  });

  describe("given a run that lists the same trace id twice", () => {
    /**
     * The TraceIds array is not distinct. On local data it held 1,450 entries
     * over 493 distinct traces, so a cost summed over that column instead of
     * over the trace map would report roughly three times the real spend.
     *
     * @scenario "A trace listed twice on a run is counted once"
     */
    it("counts that trace once", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          totalCost: null,
          traceIds: ["t1", "t1", "t1"],
          traceMetricsJson: JSON.stringify({ t1: { totalCost: 0.05 } }),
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(Number(atoms[0]?.CostUsd)).toBeCloseTo(0.05, 6);
    });
  });

  describe("given a run whose traces all cost zero", () => {
    /**
     * The fold writes the stored total as NULL when the traces sum to zero, so
     * without the trace map this run is indistinguishable from one that was
     * never measured. Telling the two apart is what stops the page reporting a
     * total that looks complete and is not.
     *
     * @scenario "A run that spent nothing reads as zero, not as unknown"
     */
    it("reads as zero and not as unknown", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          totalCost: null,
          traceIds: ["t1"],
          traceMetricsJson: JSON.stringify({ t1: { totalCost: 0 } }),
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(Number(atoms[0]?.CostUsd)).toBe(0);
      expect(atoms[0]?.CostSource).toBe("traces");
    });
  });

  describe("given a run with traces whose cost was never computed", () => {
    /** @scenario "A run whose cost was never measured reads as unknown, not as zero" */
    it("reads as unknown, with no number at all", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          totalCost: null,
          traceIds: ["t1"],
          traceMetricsJson: "",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.CostUsd).toBe("");
      expect(atoms[0]?.CostSource).toBe("unknown");
    });
  });

  describe("given a run that reached no trace at all", () => {
    /** @scenario "A run that started nothing costs nothing" */
    it("reads as a known zero", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          status: "ERROR",
          totalCost: null,
          traceIds: [],
          traceMetricsJson: "",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.CostUsd).toBe("0");
      expect(atoms[0]?.CostSource).toBe("none");
    });
  });

  describe("given one run with a cost and one whose cost is unknown", () => {
    /** @scenario "The overview says how many atoms have no known cost" */
    it("totals only the known cost and counts the unknown ones", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          totalCost: 0.5,
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          totalCost: null,
          traceIds: ["t1"],
          traceMetricsJson: "",
        }),
      ]);

      const totals = await repo.aggregateTotals(
        baseFilter({ scenarioSetIds: [setId] }),
      );

      expect(Number(totals?.CostTotal)).toBeCloseTo(0.5, 6);
      expect(Number(totals?.CostUnknown)).toBe(1);
      expect(Number(totals?.Atoms)).toBe(2);
    });
  });
});

describe("filters", () => {
  describe("when a run started before the period", () => {
    /** @scenario "The period keeps out runs outside it" */
    it("is left out", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          startedAt: new Date(windowStart - 60 * 24 * 60 * 60 * 1000),
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          startedAt: new Date(now - 60_000),
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
    });
  });

  describe("when the filter names one scenario of three", () => {
    /** @scenario "A filter on scenarios keeps only those scenarios" */
    it("keeps only that scenario", async () => {
      const setId = `set-${nanoid(6)}`;
      const wanted = `scen-${nanoid(6)}`;
      await insertRows([
        makeRow({
          scenarioId: wanted,
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
        }),
        makeRow({ batchRunId: `batch-${nanoid(6)}`, scenarioSetId: setId }),
        makeRow({ batchRunId: `batch-${nanoid(6)}`, scenarioSetId: setId }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId], scenarioIds: [wanted] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.ScenarioId).toBe(wanted);
    });
  });

  describe("when the filter names one target of two", () => {
    /** @scenario "A filter on targets keeps only those targets" */
    it("keeps only that target", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
        }),
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "agent_prod",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({
          scenarioSetIds: [setId],
          targetKeys: ["agent_dev"],
        }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.TargetKey).toBe("agent_dev");
    });
  });

  describe("when the filter asks for failed runs", () => {
    /**
     * The status filter must apply AFTER dedup. Filtering versions by status
     * would resolve a finished run to whichever old version still said it was
     * running, which is a stale row that looks entirely plausible.
     *
     * @scenario "A filter on status keeps only runs of that status"
     */
    it("keeps only the failed run, reading the latest version of each", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      const failedRunId = `run-${nanoid(10)}`;
      const startedAt = new Date(now - 60_000);
      await insertRows([
        makeRow({ batchRunId, scenarioSetId: setId, status: "SUCCESS" }),
        makeRow({
          scenarioRunId: failedRunId,
          batchRunId,
          scenarioSetId: setId,
          status: "IN_PROGRESS",
          startedAt,
          updatedAt: new Date(now - 50_000),
        }),
        makeRow({
          scenarioRunId: failedRunId,
          batchRunId,
          scenarioSetId: setId,
          status: "FAILED",
          startedAt,
          updatedAt: new Date(now - 40_000),
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId], outcome: "failed" }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.ScenarioRunId).toBe(failedRunId);
    });
  });
});

describe("findRunOrdinals", () => {
  describe("given a plan with three runs inside the period", () => {
    /** @scenario "The number of a run counts the runs of its plan, oldest first" */
    it("numbers them from one, oldest first", async () => {
      const setId = `set-${nanoid(6)}`;
      const batches = ["oldest", "middle", "newest"].map(
        (label) => `batch-${label}-${nanoid(6)}`,
      );
      await insertRows(
        batches.flatMap((batchRunId, index) =>
          Array.from({ length: 2 }, () =>
            makeRow({
              batchRunId,
              scenarioSetId: setId,
              startedAt: new Date(now - (3 - index) * 60 * 60 * 1000),
            }),
          ),
        ),
      );

      const ordinals = await repo.findRunOrdinals(
        baseFilter({ scenarioSetIds: [setId] }),
      );

      const byBatch = new Map(
        ordinals.map((row) => [row.BatchRunId, Number(row.Ordinal)]),
      );
      expect(byBatch.get(batches[0]!)).toBe(1);
      expect(byBatch.get(batches[1]!)).toBe(2);
      expect(byBatch.get(batches[2]!)).toBe(3);
    });
  });
});

describe("aggregateGroups", () => {
  describe("when grouped by target", () => {
    /** @scenario "The overview groups by target" */
    it("gives one group per target, each with its own pass rate", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
          status: "SUCCESS",
        }),
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "agent_prod",
          status: "FAILED",
        }),
      ]);

      const groups = await repo.aggregateGroups({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        groupBy: "target",
      });

      const byKey = new Map(groups.map((group) => [group.GroupKey, group]));
      expect(Number(byKey.get("agent_dev")?.Passed)).toBe(1);
      expect(Number(byKey.get("agent_prod")?.Passed)).toBe(0);
      expect(Number(byKey.get("agent_prod")?.Settled)).toBe(1);
    });
  });

  describe("when a filter narrows the scope", () => {
    /** @scenario "The overview totals move when a filter moves" */
    it("moves the totals with it", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      await insertRows([
        makeRow({ batchRunId, scenarioSetId: setId, status: "SUCCESS" }),
        makeRow({ batchRunId, scenarioSetId: setId, status: "FAILED" }),
      ]);

      const all = await repo.aggregateTotals(
        baseFilter({ scenarioSetIds: [setId] }),
      );
      const failedOnly = await repo.aggregateTotals(
        baseFilter({ scenarioSetIds: [setId], outcome: "failed" }),
      );

      expect(Number(all?.Atoms)).toBe(2);
      expect(Number(all?.Passed)).toBe(1);
      expect(Number(failedOnly?.Atoms)).toBe(1);
      expect(Number(failedOnly?.Passed)).toBe(0);
      expect(Number(failedOnly?.FailingScenarios)).toBe(1);
    });
  });
});
