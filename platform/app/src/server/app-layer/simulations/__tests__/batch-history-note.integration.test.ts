/**
 * The run note, read back off the runs that already load with batch history.
 *
 * @see specs/suites/run-notes.feature
 * @see specs/suites/run-note-metadata-convention.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResilientClickHouseClient } from "~/server/clickhouse/managedClient";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { SimulationClickHouseRepository } from "../repositories/simulation.clickhouse.repository";

const tenantId = `test-run-note-${nanoid()}`;
const now = Date.now();

function makeRunRow({
  scenarioSetId,
  batchRunId,
  metadata,
  startedAt = new Date(now - 5000),
}: {
  scenarioSetId: string;
  batchRunId: string;
  metadata: Record<string, unknown> | null;
  startedAt?: Date;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: batchRunId,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: "SUCCESS",
    Name: "Refund Flow",
    Description: null,
    Metadata: metadata === null ? null : JSON.stringify(metadata),
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
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: new Date(startedAt.getTime() + 1000),
    FinishedAt: new Date(startedAt.getTime() + 1000),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
  };
}

let ch: ClickHouseClient;
let repo: SimulationClickHouseRepository;

async function insertRows(rows: ReturnType<typeof makeRunRow>[]) {
  await ch.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repo = new SimulationClickHouseRepository(async () => resilient);
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

describe("the note of a batch", () => {
  describe("when every run of the batch carries the same note", () => {
    /** @scenario "Batch history reads the note from the runs it already loads" */
    it("reports the note on the batch in the history page", async () => {
      const scenarioSetId = `set-note-${nanoid()}`;
      const batchRunId = `batch-note-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { note: "switched judge to the stricter criterion" },
        }),
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { note: "switched judge to the stricter criterion" },
        }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const batch = result.batches.find((b) => b.batchRunId === batchRunId);
      expect(batch?.note).toBe("switched judge to the stricter criterion");
    });

    /** @scenario "The batch summary of one batch reports its note" */
    it("reports the note on the summary of that one batch", async () => {
      const scenarioSetId = `set-note-summary-${nanoid()}`;
      const batchRunId = `batch-note-summary-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { note: "nightly regression" },
        }),
      ]);

      const summary = await repo.getBatchSummary({
        projectId: tenantId,
        batchRunId,
      });

      expect(summary?.note).toBe("nightly regression");
    });
  });

  describe("when the batch was started without a note", () => {
    /** @scenario "A batch whose runs carry no note reports no note" */
    it("reports no note in the history page", async () => {
      const scenarioSetId = `set-no-note-${nanoid()}`;
      const batchRunId = `batch-no-note-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { parameters: { account_tier: "gold" } },
        }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const batch = result.batches.find((b) => b.batchRunId === batchRunId);
      expect(batch?.note).toBeNull();
    });

    /** @scenario "A batch whose runs carry no note reports no note" */
    it("reports no note on the summary of that one batch", async () => {
      const scenarioSetId = `set-no-note-summary-${nanoid()}`;
      const batchRunId = `batch-no-note-summary-${nanoid()}`;
      await insertRows([
        makeRunRow({ scenarioSetId, batchRunId, metadata: null }),
      ]);

      const summary = await repo.getBatchSummary({
        projectId: tenantId,
        batchRunId,
      });

      expect(summary?.note).toBeNull();
    });
  });

  describe("when only some runs of the batch carry a note", () => {
    it("reports the first note it finds in the history page", async () => {
      const scenarioSetId = `set-mixed-note-${nanoid()}`;
      const batchRunId = `batch-mixed-note-${nanoid()}`;
      await insertRows([
        makeRunRow({ scenarioSetId, batchRunId, metadata: null }),
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { note: "retry after the timeout fix" },
        }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const batch = result.batches.find((b) => b.batchRunId === batchRunId);
      expect(batch?.note).toBe("retry after the timeout fix");
    });

    it("reports that note on the summary of that one batch", async () => {
      const scenarioSetId = `set-mixed-note-summary-${nanoid()}`;
      const batchRunId = `batch-mixed-note-summary-${nanoid()}`;
      await insertRows([
        makeRunRow({ scenarioSetId, batchRunId, metadata: null }),
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { note: "retry after the timeout fix" },
        }),
      ]);

      const summary = await repo.getBatchSummary({
        projectId: tenantId,
        batchRunId,
      });

      expect(summary?.note).toBe("retry after the timeout fix");
    });
  });

  describe("when a run set holds batches with notes and batches without", () => {
    /** @scenario "Batch history reads the note from the runs it already loads" */
    it("reports each batch's own note, or none", async () => {
      const scenarioSetId = `set-some-notes-${nanoid()}`;
      const noted = `batch-noted-${nanoid()}`;
      const unnoted = `batch-unnoted-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId: noted,
          metadata: { note: "before the criterion change" },
        }),
        makeRunRow({ scenarioSetId, batchRunId: unnoted, metadata: null }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const byId = new Map(result.batches.map((b) => [b.batchRunId, b]));
      expect(byId.get(noted)?.note).toBe("before the criterion change");
      expect(byId.get(unnoted)?.note).toBeNull();
    });
  });
});

describe("a batch produced by an SDK or CI run", () => {
  describe("when the runs set the note in their own run metadata", () => {
    /** @scenario "An external SDK batch with no run plan record still reports its note" */
    /** @scenario "A note given by an SDK or CI run is stored with the batch" */
    it("reports the note for a set that has no run plan behind it", async () => {
      // An external set id: no `__internal__<suiteId>__suite` shape, so nothing
      // in the platform ever recorded a run plan for this batch.
      const scenarioSetId = `ci-nightly-${nanoid()}`;
      const batchRunId = `batch-external-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { note: "abc1234", environment: "staging" },
        }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const batch = result.batches.find((b) => b.batchRunId === batchRunId);
      expect(batch?.note).toBe("abc1234");
    });

    /** @scenario "A note set directly by an SDK caller reads like a platform note" */
    it("keeps the note and the other metadata keys the caller set", async () => {
      const scenarioSetId = `ci-kept-${nanoid()}`;
      const batchRunId = `batch-kept-${nanoid()}`;
      const row = makeRunRow({
        scenarioSetId,
        batchRunId,
        metadata: { note: "abc1234", environment: "staging", attempt: 2 },
      });
      await insertRows([row]);

      const run = await repo.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: row.ScenarioRunId,
      });

      expect(run?.metadata).toEqual({
        note: "abc1234",
        environment: "staging",
        attempt: 2,
      });
    });
  });
});

describe("the cost of reading the note", () => {
  describe("when a page of batch history is read", () => {
    /** @scenario "Reading the note keeps the run set query bounded to the page" */
    it("reads the note only in the query already bounded to the page", async () => {
      const scenarioSetId = `set-bounded-${nanoid()}`;
      const batchRunId = `batch-bounded-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: { note: "nightly regression" },
        }),
      ]);

      const captured: string[] = [];
      const recordingClient = new Proxy(ch, {
        get(target, prop, receiver) {
          if (prop === "query") {
            return (args: { query: string }) => {
              captured.push(args.query);
              return (target.query as typeof target.query).call(target, args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const recordingRepo = new SimulationClickHouseRepository(async () =>
        createResilientClickHouseClient({ client: recordingClient }),
      );

      const result = await recordingRepo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      expect(result.batches[0]?.note).toBe("nightly regression");

      const noteQueries = captured.filter((q) => q.includes("AS Note"));
      expect(noteQueries).toHaveLength(1);
      // The one query that reads the note is the preview read, which is already
      // bounded to the page's batch ids and their StartedAt window.
      expect(noteQueries[0]).toContain("BatchRunId IN ({batchRunIds:");
      expect(noteQueries[0]).toContain("StartedAt >=");

      // The query that counts the whole set never touches run metadata.
      const wholeSetQueries = captured.filter((q) =>
        q.includes("count(DISTINCT BatchRunId)"),
      );
      expect(wholeSetQueries).toHaveLength(1);
      expect(wholeSetQueries[0]).not.toContain("Metadata");
    });
  });
});
