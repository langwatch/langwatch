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
import { targetKeyOf } from "../../../../suites/target-key";
import type { ResultsFilter } from "../atom.types";
import {
  MAX_RUN_TARGETS,
  MAX_TREND_POINTS,
  ResultAtomsClickHouseRepository,
} from "../result-atoms.clickhouse.repository";

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
  targetKey,
  targetParameters,
  note,
  archivedAt = null,
  durationMs = "1500",
  name = "Refund Flow",
  agents,
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
  /** The key the platform stamped; left out on a run recorded before it existed. */
  targetKey?: string;
  /** The overrides of the target; left out on a target with none. */
  targetParameters?: Record<string, string | number | boolean>;
  note?: string;
  archivedAt?: Date | null;
  durationMs?: string | null;
  name?: string | null;
  /** What the code that pushed the run reported about who took part in it. */
  agents?: { name: string; role: "agent" | "user" | "judge" }[];
}) {
  const metadata: Record<string, unknown> = {};
  if (targetReferenceId) {
    metadata.langwatch = {
      targetReferenceId,
      ...(targetKey !== undefined && { targetKey }),
      ...(targetParameters !== undefined && { targetParameters }),
    };
  }
  if (note) metadata.note = note;
  if (agents) metadata.agents = agents;

  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    ScenarioRunId: scenarioRunId,
    ScenarioId: scenarioId,
    BatchRunId: batchRunId,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: status,
    Name: name,
    Description: null,
    Metadata:
      Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
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

  describe("given a run pushed from code that carries a name", () => {
    /** @scenario "An atom carries the name its run was given" */
    it("reads that name and folds under its set and that name", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: "List agents",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.ScenarioName).toBe("List agents");
      expect(atoms[0]?.ScenarioKey).toBe(`${setId}-list-agents`);
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

  describe("given a stored row that names no scenario", () => {
    /** @scenario "A row that names no scenario is not an atom" */
    it("leaves it out", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          scenarioId: "",
        }),
        makeRow({ batchRunId: `batch-${nanoid(6)}`, scenarioSetId: setId }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.ScenarioId).not.toBe("");
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
     */
    /** @scenario "A trace listed twice on a run is counted once" */
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
     */
    /** @scenario "A run that spent nothing reads as zero, not as unknown" */
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
      // Runs started on the platform, so each is keyed by its scenario id.
      await insertRows([
        makeRow({
          scenarioId: wanted,
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId], scenarioIds: [wanted] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.ScenarioId).toBe(wanted);
    });
  });

  describe("when the filter names a scenario that ran from code by its key", () => {
    /** @scenario "A filter on scenarios keeps a scenario that ran from code by its key" */
    it("keeps only the runs of that name", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: "List agents",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: "List agents",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: "List prompts",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({
          scenarioSetIds: [setId],
          scenarioIds: [`${setId}-list-agents`],
        }),
        limit: 10,
      });

      expect(atoms).toHaveLength(2);
      expect(atoms.every((atom) => atom.ScenarioName === "List agents")).toBe(
        true,
      );
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
     */
    /** @scenario "A filter on status keeps only runs of that status" */
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

describe("the target of a run that reports its agents", () => {
  const reported = [
    { name: "AcmeSupportAgent", role: "agent" as const },
    { name: "UserSimulatorAgent", role: "user" as const },
    { name: "JudgeAgent", role: "judge" as const },
  ];

  describe("given a run pushed from code that reports an agent", () => {
    /** @scenario "A run that reports its agents names its target by the agent it tested" */
    it("keys the target by the agent name and leaves the simulator and the judge out", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          agents: reported,
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(1);
      expect(atoms[0]?.TargetKey).toBe("code:acmesupportagent");
      expect(atoms[0]?.TargetName).toBe("AcmeSupportAgent");
      expect(atoms[0]?.Trigger).toBe("code");
    });
  });

  describe("given two runs that report the same agent", () => {
    /** @scenario "Two runs of one agent name fold under one target" */
    it("folds them under one target group", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          agents: reported,
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          agents: reported,
        }),
      ]);

      const groups = await repo.aggregateGroups({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        groupBy: "target",
      });

      expect(groups).toHaveLength(1);
      expect(groups[0]?.GroupKey).toBe("code:acmesupportagent");
      expect(groups[0]?.TargetName).toBe("AcmeSupportAgent");
      expect(groups[0]?.Atoms).toBe("2");
    });
  });

  describe("given a run that reports no agent", () => {
    /** @scenario "A run that reports no agent stays under the unknown target" */
    it("keeps it under the unknown key with no target name", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          agents: [{ name: "UserSimulatorAgent", role: "user" }],
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.TargetKey).toBe("unknown");
      expect(atoms[0]?.TargetName).toBe("");
    });
  });

  describe("given a run started on the platform that also reports an agent", () => {
    /** @scenario "A run started on the platform keeps its platform target" */
    it("keeps the reference id the platform stamped", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
          agents: reported,
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.TargetKey).toBe("agent_dev");
      expect(atoms[0]?.Trigger).toBe("app");
    });
  });
});

describe("the target of a run whose target carries parameters", () => {
  const overrides = { model: "gpt-5-mini" };
  const variantKey = targetKeyOf({
    referenceId: "prod-agent",
    runParameters: overrides,
  });

  describe("given one run against an agent and against the same agent with overrides", () => {
    /** @scenario "A target with parameter overrides is its own target" */
    it("gives each its own atom, keyed apart, the variant carrying its overrides", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: "prod-agent",
        }),
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: variantKey,
          targetParameters: overrides,
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms).toHaveLength(2);
      const byKey = new Map(atoms.map((atom) => [atom.TargetKey, atom]));
      expect(variantKey).not.toBe("prod-agent");
      expect(byKey.get("prod-agent")?.TargetParameters).toBe("");
      expect(JSON.parse(byKey.get(variantKey)?.TargetParameters ?? "")).toEqual(
        overrides,
      );
    });

    /** @scenario "The overview groups a parameter variant apart from its agent" */
    it("folds them into two target groups, the variant carrying its overrides", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: "prod-agent",
          status: "SUCCESS",
        }),
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: variantKey,
          targetParameters: overrides,
          status: "FAILED",
        }),
      ]);

      const groups = await repo.aggregateGroups({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        groupBy: "target",
      });

      expect(groups).toHaveLength(2);
      const byKey = new Map(groups.map((group) => [group.GroupKey, group]));
      expect(byKey.get("prod-agent")?.TargetParameters).toBe("");
      expect(Number(byKey.get("prod-agent")?.Passed)).toBe(1);
      expect(JSON.parse(byKey.get(variantKey)?.TargetParameters ?? "")).toEqual(
        overrides,
      );
      expect(Number(byKey.get(variantKey)?.Passed)).toBe(0);
    });

    it("keeps a filter on the variant's key to the variant alone", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunId = `batch-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: "prod-agent",
        }),
        makeRow({
          batchRunId,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: variantKey,
          targetParameters: overrides,
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({
          scenarioSetIds: [setId],
          targetKeys: [variantKey],
        }),
        limit: 10,
      });

      expect(atoms.map((atom) => atom.TargetKey)).toEqual([variantKey]);
    });
  });

  describe("given a run recorded before target keys were stamped", () => {
    /** @scenario "An old run with no target key keeps its reference id as key" */
    it("keys under its reference id, with no target parameters", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
        }),
      ]);

      const { atoms } = await repo.findAtoms({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        limit: 10,
      });

      expect(atoms[0]?.TargetKey).toBe("prod-agent");
      expect(atoms[0]?.TargetParameters).toBe("");
    });
  });
});

describe("findRunTargets", () => {
  describe("given a variant of a stored target, a plain run of it, and a run from code", () => {
    /** @scenario "The run targets list carries parameter variants" */
    it("lists the variant with its reference id and overrides, the code target, and not the plain run", async () => {
      const setId = `set-${nanoid(6)}`;
      const overrides = { model: "gpt-5-mini" };
      const variantKey = targetKeyOf({
        referenceId: "prod-agent",
        runParameters: overrides,
      });
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: variantKey,
          targetParameters: overrides,
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "prod-agent",
          targetKey: "prod-agent",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          agents: [{ name: "AcmeSupportAgent", role: "agent" }],
        }),
      ]);

      const rows = await repo.findRunTargets(
        baseFilter({ scenarioSetIds: [setId] }),
      );

      expect(rows.map((row) => row.TargetKey)).toEqual([
        variantKey,
        "code:acmesupportagent",
      ]);
      expect(rows[0]).toMatchObject({
        Name: "",
        ReferenceId: "prod-agent",
      });
      expect(JSON.parse(rows[0]?.TargetParameters ?? "")).toEqual(overrides);
      expect(rows[1]).toMatchObject({
        Name: "AcmeSupportAgent",
        ReferenceId: "",
        TargetParameters: "",
      });
    });
  });

  describe("given runs from code, one naming no agent, and a platform run", () => {
    /** @scenario "The targets named by runs from code are listed for the filter" */
    it("lists the named agents in name order and leaves the rest out", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          agents: [{ name: "AcmeSupportAgent", role: "agent" }],
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          agents: [{ name: "AcmeBillingAgent", role: "agent" }],
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
          agents: [{ name: "PlatformAgent", role: "agent" }],
        }),
      ]);

      const rows = await repo.findRunTargets(
        baseFilter({ scenarioSetIds: [setId] }),
      );

      expect(rows).toEqual([
        {
          TargetKey: "code:acmebillingagent",
          Name: "AcmeBillingAgent",
          ReferenceId: "",
          TargetParameters: "",
        },
        {
          TargetKey: "code:acmesupportagent",
          Name: "AcmeSupportAgent",
          ReferenceId: "",
          TargetParameters: "",
        },
      ]);
      expect(rows.length).toBeLessThanOrEqual(MAX_RUN_TARGETS);
    });
  });
});

describe("findCodeScenarios", () => {
  describe("given runs from code and a run started on the platform", () => {
    /** @scenario "The scenarios that ran from code are listed for the filter" */
    it("lists the code scenarios under their keys and leaves the platform run out", async () => {
      const setId = `set-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: "List agents",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: "List agents",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: "List prompts",
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
          name: "Refund flow",
        }),
      ]);

      const rows = await repo.findCodeScenarios(
        baseFilter({ scenarioSetIds: [setId] }),
      );

      expect(rows).toEqual([
        { ScenarioKey: `${setId}-list-agents`, Name: "List agents" },
        { ScenarioKey: `${setId}-list-prompts`, Name: "List prompts" },
      ]);
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
  describe("when grouped by scenario over runs pushed from code", () => {
    /** @scenario "A run pushed from code folds under its set and its name" */
    it("folds runs of one name in one set together, and keeps sets apart", async () => {
      const german = `german-${nanoid(6)}`;
      const english = `english-${nanoid(6)}`;
      await insertRows([
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: german,
          name: "List agents",
          status: "SUCCESS",
        }),
        // An older run under a spelling that folds to the same key. The group
        // reads the name its newest run carried.
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: german,
          name: "list-agents",
          status: "FAILED",
          startedAt: new Date(now - 120_000),
        }),
        makeRow({
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: english,
          name: "List agents",
        }),
      ]);

      const groups = await repo.aggregateGroups({
        filter: baseFilter({ scenarioSetIds: [german, english] }),
        groupBy: "scenario",
      });

      const byKey = new Map(groups.map((group) => [group.GroupKey, group]));
      expect([...byKey.keys()].sort()).toEqual(
        [`${german}-list-agents`, `${english}-list-agents`].sort(),
      );
      expect(Number(byKey.get(`${german}-list-agents`)?.Atoms)).toBe(2);
      expect(Number(byKey.get(`${german}-list-agents`)?.Passed)).toBe(1);
      expect(byKey.get(`${german}-list-agents`)?.Name).toBe("List agents");
    });

    /** @scenario "A run started on the platform folds under its scenario id" */
    it("keeps a run started on the platform under its scenario id", async () => {
      const setId = `set-${nanoid(6)}`;
      const scenarioId = `scen-${nanoid(6)}`;
      await insertRows([
        makeRow({
          scenarioId,
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          targetReferenceId: "agent_dev",
          name: "List agents",
        }),
      ]);

      const groups = await repo.aggregateGroups({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        groupBy: "scenario",
      });

      expect(groups.map((group) => group.GroupKey)).toEqual([scenarioId]);
    });

    /** @scenario "A run pushed from code with no name keeps its id" */
    it("keeps a run from code that carries no name under its own id", async () => {
      const setId = `set-${nanoid(6)}`;
      const scenarioId = `scen-${nanoid(6)}`;
      await insertRows([
        makeRow({
          scenarioId,
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
          name: null,
        }),
      ]);

      const groups = await repo.aggregateGroups({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        groupBy: "scenario",
      });

      expect(groups.map((group) => group.GroupKey)).toEqual([scenarioId]);
    });
  });

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

describe("aggregateTrend", () => {
  describe("given a plan with more runs in the period than a sparkline draws", () => {
    /** @scenario "A sparkline asks the database only for the points it draws" */
    it("returns only the points drawn, and the most recent of them", async () => {
      const setId = `set-${nanoid(6)}`;
      const runCount = MAX_TREND_POINTS + 6;
      // One batch per hour, oldest first, so the newest batches are the ones
      // with the largest index.
      const batchRunIds = Array.from(
        { length: runCount },
        (_, index) => `batch-${String(index).padStart(3, "0")}-${nanoid(4)}`,
      );

      await insertRows(
        batchRunIds.map((batchRunId, index) =>
          makeRow({
            batchRunId,
            scenarioSetId: setId,
            startedAt: new Date(now - (runCount - index) * 60 * 60 * 1000),
          }),
        ),
      );

      const rows = await repo.aggregateTrend({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        groupBy: "plan",
      });

      expect(rows).toHaveLength(MAX_TREND_POINTS);
      expect(new Set(rows.map((row) => row.TrendKey))).toEqual(
        new Set(batchRunIds.slice(-MAX_TREND_POINTS)),
      );
    });
  });

  describe("given a plan with fewer runs than a sparkline draws", () => {
    /** @scenario "A group carries one trend point per run" */
    it("returns one point per run", async () => {
      const setId = `set-${nanoid(6)}`;
      const batchRunIds = ["a", "b", "c"].map(
        (suffix) => `batch-${suffix}-${nanoid(4)}`,
      );

      await insertRows(
        batchRunIds.map((batchRunId, index) =>
          makeRow({
            batchRunId,
            scenarioSetId: setId,
            status: index === 1 ? "FAILED" : "SUCCESS",
            startedAt: new Date(now - (3 - index) * 60 * 60 * 1000),
          }),
        ),
      );

      const rows = await repo.aggregateTrend({
        filter: baseFilter({ scenarioSetIds: [setId] }),
        groupBy: "plan",
      });

      expect(rows).toHaveLength(3);
      const byKey = new Map(rows.map((row) => [row.TrendKey, row]));
      expect(Number(byKey.get(batchRunIds[1]!)?.Passed)).toBe(0);
      expect(Number(byKey.get(batchRunIds[1]!)?.Settled)).toBe(1);
    });
  });
});
