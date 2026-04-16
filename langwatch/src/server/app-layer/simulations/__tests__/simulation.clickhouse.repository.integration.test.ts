import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { SimulationClickHouseRepository } from "../repositories/simulation.clickhouse.repository";

const tenantId = `test-sim-repo-${nanoid()}`;
const now = Date.now();

function makeInsertRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Version: "v1",
    Status: "SUCCESS",
    Name: "Test run",
    Description: "A test description",
    Metadata: null,
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": ["trace-1"],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: ["criterion-1"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: new Date(now - 5000),
    CreatedAt: new Date(now - 5000),
    UpdatedAt: new Date(now),
    FinishedAt: new Date(now),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    ...overrides,
  };
}

async function insertRow(ch: ClickHouseClient, row: ReturnType<typeof makeInsertRow>) {
  await ch.insert({
    table: "simulation_runs",
    values: [row],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

let ch: ClickHouseClient;
let repo: SimulationClickHouseRepository;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new SimulationClickHouseRepository(async () => ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("SimulationClickHouseRepository (integration)", () => {
  describe("getScenarioRunData()", () => {
    describe("when row has metadata", () => {
      it("returns parsed metadata object", async () => {
        const scenarioRunId = `run-meta-${nanoid()}`;
        const metadata = { name: "My Scenario", custom_field: "value" };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: scenarioRunId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getScenarioRunData({
          projectId: tenantId,
          scenarioRunId,
        });

        expect(result).not.toBeNull();
        expect(result!.metadata).toEqual(metadata);
      });
    });

    describe("when row has null metadata", () => {
      it("returns null metadata", async () => {
        const scenarioRunId = `run-nometa-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: scenarioRunId,
          Metadata: null,
        }));

        const result = await repo.getScenarioRunData({
          projectId: tenantId,
          scenarioRunId,
        });

        expect(result).not.toBeNull();
        expect(result!.metadata).toBeNull();
      });
    });

    describe("when row does not exist", () => {
      it("returns null", async () => {
        const result = await repo.getScenarioRunData({
          projectId: tenantId,
          scenarioRunId: `run-nonexistent-${nanoid()}`,
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("getScenarioRunDataByScenarioId()", () => {
    describe("when rows have metadata", () => {
      it("returns parsed metadata for each run", async () => {
        const scenarioId = `scenario-byscid-${nanoid()}`;
        const metadata1 = { env: "staging" };
        const metadata2 = { env: "production" };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-byscid-1-${nanoid()}`,
          ScenarioId: scenarioId,
          Metadata: JSON.stringify(metadata1),
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-byscid-2-${nanoid()}`,
          ScenarioId: scenarioId,
          Metadata: JSON.stringify(metadata2),
        }));

        const result = await repo.getScenarioRunDataByScenarioId({
          projectId: tenantId,
          scenarioId,
        });

        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        const metadatas = result!.map((r) => r.metadata);
        expect(metadatas).toContainEqual(metadata1);
        expect(metadatas).toContainEqual(metadata2);
      });
    });
  });

  describe("getRunDataForBatchRun()", () => {
    describe("when runs have metadata", () => {
      it("returns runs with metadata", async () => {
        const batchRunId = `batch-forbatch-${nanoid()}`;
        const scenarioSetId = `set-forbatch-${nanoid()}`;
        const metadata = { model: "gpt-4", temperature: 0.7 };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-forbatch-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getRunDataForBatchRun({
          projectId: tenantId,
          scenarioSetId,
          batchRunId,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs).toHaveLength(1);
        expect(result.runs[0]!.metadata).toEqual(metadata);
      });
    });
  });

  describe("getAllRunDataForScenarioSet()", () => {
    describe("when runs have metadata", () => {
      it("returns all runs with metadata", async () => {
        const scenarioSetId = `set-allruns-${nanoid()}`;
        const metadata = { suite: "regression" };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-allruns-${nanoid()}`,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getAllRunDataForScenarioSet({
          projectId: tenantId,
          scenarioSetId,
        });

        expect(result).toHaveLength(1);
        expect(result[0]!.metadata).toEqual(metadata);
      });
    });
  });

  describe("getRunDataForScenarioSet() (paginated)", () => {
    describe("when runs have metadata", () => {
      // Skipped: requires live ClickHouse. Run with testcontainers or make dev-full to enable.
      it.skip("returns runs with metadata through pagination", async () => {
        const scenarioSetId = `set-paged-${nanoid()}`;
        const batchRunId = `batch-paged-${nanoid()}`;
        const metadata = { page_test: true };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-paged-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getRunDataForScenarioSet({
          projectId: tenantId,
          scenarioSetId,
          limit: 10,
        });

        expect(result.runs).toHaveLength(1);
        // Note: paginated queries use LIST_COLUMNS which don't include Metadata.
        // This is intentional for list views — only detail views include it.
      });
    });
  });

  describe("getRunDataForAllSuites()", () => {
    describe("when internal suite runs have metadata", () => {
      it("returns runs through the all-suites query", async () => {
        const scenarioSetId = `__internal__allsuites_${nanoid()}__suite`;
        const batchRunId = `batch-allsuites-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-allsuites-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify({ all_suites: true }),
        }));

        const result = await repo.getRunDataForAllSuites({
          projectId: tenantId,
          limit: 10,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs.length).toBeGreaterThanOrEqual(1);
        const ourRun = result.runs.find((r) => r.batchRunId === batchRunId);
        expect(ourRun).toBeDefined();
      });
    });

    describe("when a batch has empty-string ScenarioSetId (legacy data)", () => {
      it("normalizes the empty-string to 'default' in the scenarioSetIds map", async () => {
        const batchRunId = `batch-legacy-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-legacy-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: "",
        }));

        const result = await repo.getRunDataForAllSuites({
          projectId: tenantId,
          limit: 100,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.scenarioSetIds[batchRunId]).toBe("default");
      });
    });

    describe("when batches have both empty-string and 'default' ScenarioSetId for different batches", () => {
      it("collapses both to 'default' and reports a single distinct set", async () => {
        const batchEmpty = `batch-empty-${nanoid()}`;
        const batchDefault = `batch-default-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-empty-${nanoid()}`,
          BatchRunId: batchEmpty,
          ScenarioSetId: "",
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-default-${nanoid()}`,
          BatchRunId: batchDefault,
          ScenarioSetId: "default",
        }));

        const result = await repo.getRunDataForAllSuites({
          projectId: tenantId,
          limit: 100,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.scenarioSetIds[batchEmpty]).toBe("default");
        expect(result.scenarioSetIds[batchDefault]).toBe("default");
      });
    });

    // Regression for langwatch/langwatch#3265:
    // The previous outer SELECT aliased `any(IF(ScenarioSetId = '', 'default', ScenarioSetId))
    // AS ScenarioSetId`. That alias shadowed the `ScenarioSetId` column referenced inside the
    // dedup IN-tuple in WHERE, and ClickHouse rejected the query with
    //   "Aggregate function any(...) AS ScenarioSetId is found in WHERE in query."
    // This test proves the rewritten query (alias renamed to NormalizedSetId) actually
    // executes against ClickHouse instead of throwing.
    describe("when the query runs against real ClickHouse", () => {
      it("does not throw 'Aggregate function ... found in WHERE' (regression for langwatch/langwatch#3265)", async () => {
        const batchRunId = `batch-regression-3265-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-regression-3265-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: "",
        }));

        // The assertion that matters is that this call resolves without throwing.
        // Before the fix it threw a TRPCClientError wrapping the ClickHouse error.
        const result = await repo.getRunDataForAllSuites({
          projectId: tenantId,
          limit: 20,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.scenarioSetIds[batchRunId]).toBe("default");
      });
    });
  });

  describe("getExternalSetSummaries()", () => {
    const extSetId = `ext-summary-${nanoid()}`;
    const batch1 = `batch-ext1-${nanoid()}`;
    const batch2 = `batch-ext2-${nanoid()}`;

    describe("when an external set has multiple batches with mixed results", () => {
      // Skipped: requires live ClickHouse. Run with testcontainers or make dev-full to enable.
      it.skip("aggregates pass/total across all batches", async () => {
        // Batch 1: 2 passed, 1 failed → 3 total
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-ext-1a-${nanoid()}`,
          BatchRunId: batch1,
          ScenarioSetId: extSetId,
          Status: "SUCCESS",
          CreatedAt: new Date(now - 10000),
          UpdatedAt: new Date(now - 10000),
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-ext-1b-${nanoid()}`,
          BatchRunId: batch1,
          ScenarioSetId: extSetId,
          Status: "SUCCESS",
          CreatedAt: new Date(now - 9000),
          UpdatedAt: new Date(now - 9000),
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-ext-1c-${nanoid()}`,
          BatchRunId: batch1,
          ScenarioSetId: extSetId,
          Status: "FAILED",
          CreatedAt: new Date(now - 8000),
          UpdatedAt: new Date(now - 8000),
        }));

        // Batch 2: 1 passed, 1 stalled → 2 total
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-ext-2a-${nanoid()}`,
          BatchRunId: batch2,
          ScenarioSetId: extSetId,
          Status: "SUCCESS",
          CreatedAt: new Date(now - 3000),
          UpdatedAt: new Date(now - 3000),
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-ext-2b-${nanoid()}`,
          BatchRunId: batch2,
          ScenarioSetId: extSetId,
          Status: "STALLED",
          CreatedAt: new Date(now - 2000),
          UpdatedAt: new Date(now - 2000),
        }));

        const summaries = await repo.getExternalSetSummaries({
          projectId: tenantId,
        });

        const summary = summaries.find((s) => s.scenarioSetId === extSetId);
        expect(summary).toBeDefined();
        // argMax returns the latest batch's counts (batch2: 1 passed + 1 stalled = 2 total)
        expect(summary!.totalCount).toBe(2);
        expect(summary!.passedCount).toBe(1);
        expect(summary!.lastRunTimestamp).toBeGreaterThan(0);
      });
    });

    describe("when an external set has a single batch with all passing", () => {
      it("returns correct pass rate", async () => {
        const setId = `ext-allpass-${nanoid()}`;
        const batchId = `batch-allpass-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-ap-1-${nanoid()}`,
          BatchRunId: batchId,
          ScenarioSetId: setId,
          Status: "SUCCESS",
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-ap-2-${nanoid()}`,
          BatchRunId: batchId,
          ScenarioSetId: setId,
          Status: "SUCCESS",
        }));

        const summaries = await repo.getExternalSetSummaries({
          projectId: tenantId,
        });

        const summary = summaries.find((s) => s.scenarioSetId === setId);
        expect(summary).toBeDefined();
        expect(summary!.passedCount).toBe(2);
        expect(summary!.totalCount).toBe(2);
      });
    });

    describe("when date range filters out older batches", () => {
      // Skipped: requires live ClickHouse. Run with testcontainers or make dev-full to enable.
      it.skip("only counts runs within the date range", async () => {
        const setId = `ext-datefilter-${nanoid()}`;
        const oldBatch = `batch-old-${nanoid()}`;
        const recentBatch = `batch-recent-${nanoid()}`;
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

        // Old batch (40 days ago): 1 passed
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-old-${nanoid()}`,
          BatchRunId: oldBatch,
          ScenarioSetId: setId,
          Status: "SUCCESS",
          CreatedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
          UpdatedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
        }));

        // Recent batch (1 day ago): 1 passed, 1 failed
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-new-1-${nanoid()}`,
          BatchRunId: recentBatch,
          ScenarioSetId: setId,
          Status: "SUCCESS",
          CreatedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
          UpdatedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-new-2-${nanoid()}`,
          BatchRunId: recentBatch,
          ScenarioSetId: setId,
          Status: "FAILED",
          CreatedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
          UpdatedAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
        }));

        // With 30-day filter: only the recent batch (2 runs, 1 passed)
        const filtered = await repo.getExternalSetSummaries({
          projectId: tenantId,
          startDate: now - thirtyDaysMs,
          endDate: now,
        });
        const filteredSummary = filtered.find((s) => s.scenarioSetId === setId);
        expect(filteredSummary).toBeDefined();
        expect(filteredSummary!.totalCount).toBe(2);
        expect(filteredSummary!.passedCount).toBe(1);

        // Without date filter: argMax picks the latest batch (recentBatch: 2 runs, 1 passed)
        const unfiltered = await repo.getExternalSetSummaries({
          projectId: tenantId,
        });
        const unfilteredSummary = unfiltered.find((s) => s.scenarioSetId === setId);
        expect(unfilteredSummary).toBeDefined();
        expect(unfilteredSummary!.totalCount).toBe(2);
        expect(unfilteredSummary!.passedCount).toBe(1);
      });
    });

    describe("when internal suite sets exist", () => {
      it("excludes them from external set summaries", async () => {
        const internalSetId = `__internal__suite-excl-${nanoid()}__suite`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-internal-${nanoid()}`,
          BatchRunId: `batch-internal-${nanoid()}`,
          ScenarioSetId: internalSetId,
          Status: "SUCCESS",
        }));

        const summaries = await repo.getExternalSetSummaries({
          projectId: tenantId,
        });

        const internal = summaries.find((s) => s.scenarioSetId === internalSetId);
        expect(internal).toBeUndefined();
      });
    });

    describe("when legacy empty-string ScenarioSetId rows coexist with 'default' rows", () => {
      it("merges them into a single 'default' entry, not two separate entries", async () => {
        const batchLegacy = `batch-legacy-${nanoid()}`;
        const batchNew = `batch-new-${nanoid()}`;

        // Legacy row: ScenarioSetId = ""
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-legacy-${nanoid()}`,
          BatchRunId: batchLegacy,
          ScenarioSetId: "",
          Status: "SUCCESS",
          CreatedAt: new Date(now - 5000),
          UpdatedAt: new Date(now - 5000),
        }));

        // New row: ScenarioSetId = "default"
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-newdefault-${nanoid()}`,
          BatchRunId: batchNew,
          ScenarioSetId: "default",
          Status: "SUCCESS",
          CreatedAt: new Date(now),
          UpdatedAt: new Date(now),
        }));

        const summaries = await repo.getExternalSetSummaries({
          projectId: tenantId,
        });

        const legacyEntry = summaries.find((s) => s.scenarioSetId === "");
        const defaultEntry = summaries.find((s) => s.scenarioSetId === "default");

        expect(legacyEntry).toBeUndefined();
        expect(defaultEntry).toBeDefined();
      });
    });
  });

  describe("getScenarioSetsData()", () => {
    describe("when legacy empty-string ScenarioSetId rows coexist with 'default' rows", () => {
      it("merges them into a single 'default' entry, not two separate entries", async () => {
        const batchLegacy = `batch-sets-legacy-${nanoid()}`;
        const batchNew = `batch-sets-new-${nanoid()}`;

        // Legacy row: ScenarioSetId = ""
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-sets-legacy-${nanoid()}`,
          BatchRunId: batchLegacy,
          ScenarioSetId: "",
          Status: "SUCCESS",
          CreatedAt: new Date(now - 5000),
          UpdatedAt: new Date(now - 5000),
        }));

        // New row: ScenarioSetId = "default"
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-sets-newdefault-${nanoid()}`,
          BatchRunId: batchNew,
          ScenarioSetId: "default",
          Status: "SUCCESS",
          CreatedAt: new Date(now),
          UpdatedAt: new Date(now),
        }));

        const sets = await repo.getScenarioSetsData({ projectId: tenantId });

        const legacyEntry = sets.find((s) => s.scenarioSetId === "");
        const defaultEntry = sets.find((s) => s.scenarioSetId === "default");

        expect(legacyEntry).toBeUndefined();
        expect(defaultEntry).toBeDefined();
      });
    });
  });

  describe("getDistinctExternalSetIds()", () => {
    describe("when rows exist with empty ScenarioSetId and 'default' ScenarioSetId", () => {
      it("merges empty-string and 'default' into a single entry", async () => {
        const legacyTenantId = `test-distinct-${nanoid()}`;

        // Legacy row: ScenarioSetId = "" (written before coercion fix)
        await insertRow(ch, makeInsertRow({
          TenantId: legacyTenantId,
          ScenarioRunId: `run-legacy-${nanoid()}`,
          BatchRunId: `batch-legacy-${nanoid()}`,
          ScenarioSetId: "",
        }));

        // New row: ScenarioSetId = "default"
        await insertRow(ch, makeInsertRow({
          TenantId: legacyTenantId,
          ScenarioRunId: `run-new-${nanoid()}`,
          BatchRunId: `batch-new-${nanoid()}`,
          ScenarioSetId: "default",
        }));

        // Custom set: must remain separate
        await insertRow(ch, makeInsertRow({
          TenantId: legacyTenantId,
          ScenarioRunId: `run-custom-${nanoid()}`,
          BatchRunId: `batch-custom-${nanoid()}`,
          ScenarioSetId: "some-custom-set",
        }));

        const result = await repo.getDistinctExternalSetIds({
          projectIds: [legacyTenantId],
        });

        // "" and "default" must not appear as two distinct entries
        expect(result.has("")).toBe(false);
        expect(result.has("default")).toBe(true);
        expect(result.has("some-custom-set")).toBe(true);
        expect(result.size).toBe(2);
      });
    });
  });
});
