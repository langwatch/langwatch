import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";

import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ScenarioRunStatus } from "../scenario-event.enums";
import {
  findQueuedRunCandidates,
  LOOKBACK_MS,
  type OrphanCandidate,
} from "../scenario-orphan-reconciler";

/**
 * Integration coverage for the reconciler's cross-tenant candidate scan
 * (findQueuedRunCandidates) against a real ClickHouse instance. The pure gate
 * and orchestrator are unit-tested elsewhere; this file exercises only the
 * dedup SQL: argMax-by-UpdatedAt version collapse, the QUEUED + orphan-cutoff
 * HAVING filter, the StartedAt lookback prune, and the oldest-first ordering.
 *
 * Deferred follow-up from PR #5008; closes #5073.
 */

const tenantId = `test-orphan-recon-${nanoid()}`;
const now = Date.now();
const HOUR_MS = 60 * 60 * 1000;
// The scan treats a QUEUED run as an orphan candidate once its latest version
// is at least this old. Cutoff = now - orphanThresholdMs.
const orphanThresholdMs = HOUR_MS;

/**
 * Builds one simulation_runs row. Defaults to a fresh ScenarioRunId, a QUEUED
 * status, a StartedAt inside the lookback window, and an UpdatedAt old enough to
 * clear the orphan cutoff. Override ScenarioRunId + UpdatedAt to write multiple
 * versions of one run.
 */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Version: "v1",
    Status: ScenarioRunStatus.QUEUED,
    Name: "Test run",
    Description: "A test description",
    Metadata: null,
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": ["trace-1"],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetricsJson: "",
    StartedAt: new Date(now - 2 * HOUR_MS),
    QueuedAt: null,
    CreatedAt: new Date(now - 2 * HOUR_MS),
    UpdatedAt: new Date(now - 2 * HOUR_MS),
    FinishedAt: null,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    LastEventOccurredAt: new Date(0),
    ...overrides,
  };
}

async function insertRows(
  ch: ClickHouseClient,
  rows: ReturnType<typeof makeRow>[],
) {
  await ch.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

let ch: ClickHouseClient;

// Stable ScenarioRunIds so assertions can target individual runs. The scan is
// cross-tenant by design, so results are filtered to this test's tenant before
// asserting (other suites share the ClickHouse container).
const ID = {
  orphanBasic: `orphan-basic-${nanoid()}`,
  orphanWasTerminal: `orphan-was-terminal-${nanoid()}`,
  recovered: `recovered-${nanoid()}`,
  queuedRecent: `queued-recent-${nanoid()}`,
  terminalOld: `terminal-old-${nanoid()}`,
  queuedAncient: `queued-ancient-${nanoid()}`,
  orphanNewest: `orphan-newest-${nanoid()}`,
};

async function candidatesForTenant(): Promise<OrphanCandidate[]> {
  const candidates = await findQueuedRunCandidates({
    client: ch,
    lookbackMs: LOOKBACK_MS,
    now,
    orphanThresholdMs,
  });
  return candidates.filter((c) => c.projectId === tenantId);
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  await insertRows(ch, [
    // orphanBasic: latest version is QUEUED and older than the cutoff. Non-key
    // columns differ between versions so argMax(col, UpdatedAt) can be asserted.
    makeRow({
      ScenarioRunId: ID.orphanBasic,
      ScenarioId: "scenario-stale",
      Status: ScenarioRunStatus.IN_PROGRESS,
      UpdatedAt: new Date(now - 3 * HOUR_MS),
    }),
    makeRow({
      ScenarioRunId: ID.orphanBasic,
      ScenarioId: "scenario-latest",
      Status: ScenarioRunStatus.QUEUED,
      UpdatedAt: new Date(now - 2 * HOUR_MS),
    }),

    // orphanWasTerminal: an earlier version was terminal (SUCCESS) but the
    // latest is QUEUED. max(Status) would pick 'SUCCESS' (S > Q) and drop the
    // run; argMax(Status, UpdatedAt) keeps the latest QUEUED, so it is included.
    makeRow({
      ScenarioRunId: ID.orphanWasTerminal,
      Status: ScenarioRunStatus.SUCCESS,
      UpdatedAt: new Date(now - 4 * HOUR_MS),
    }),
    makeRow({
      ScenarioRunId: ID.orphanWasTerminal,
      Status: ScenarioRunStatus.QUEUED,
      UpdatedAt: new Date(now - 3 * HOUR_MS),
    }),

    // recovered: was QUEUED, then progressed to a terminal status. Latest is
    // SUCCESS, so it is excluded (a finished run is never re-orphaned).
    makeRow({
      ScenarioRunId: ID.recovered,
      Status: ScenarioRunStatus.QUEUED,
      UpdatedAt: new Date(now - 4 * HOUR_MS),
    }),
    makeRow({
      ScenarioRunId: ID.recovered,
      Status: ScenarioRunStatus.SUCCESS,
      UpdatedAt: new Date(now - 2 * HOUR_MS),
    }),

    // queuedRecent: QUEUED but newer than the orphan cutoff -> excluded.
    makeRow({
      ScenarioRunId: ID.queuedRecent,
      Status: ScenarioRunStatus.QUEUED,
      StartedAt: new Date(now - 10 * 60 * 1000),
      UpdatedAt: new Date(now - 10 * 60 * 1000),
    }),

    // terminalOld: old enough, but latest status is not QUEUED -> excluded.
    makeRow({
      ScenarioRunId: ID.terminalOld,
      Status: ScenarioRunStatus.FAILED,
      UpdatedAt: new Date(now - 2 * HOUR_MS),
    }),

    // queuedAncient: QUEUED and old, but StartedAt is outside the lookback
    // window -> pruned by the StartedAt predicate before the HAVING filter.
    makeRow({
      ScenarioRunId: ID.queuedAncient,
      Status: ScenarioRunStatus.QUEUED,
      StartedAt: new Date(now - LOOKBACK_MS - 3 * 24 * HOUR_MS),
      UpdatedAt: new Date(now - LOOKBACK_MS - 3 * 24 * HOUR_MS),
    }),

    // orphanNewest: QUEUED, just past the cutoff. Used to assert oldest-first
    // ordering relative to orphanBasic and orphanWasTerminal.
    makeRow({
      ScenarioRunId: ID.orphanNewest,
      Status: ScenarioRunStatus.QUEUED,
      UpdatedAt: new Date(now - 90 * 60 * 1000),
    }),
  ]);
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

describe("findQueuedRunCandidates (integration)", () => {
  describe("given seeded simulation_runs across statuses, ages, and versions", () => {
    describe("when scanning for orphaned QUEUED candidates", () => {
      it("returns a run whose latest version is QUEUED and older than the orphan cutoff", async () => {
        const candidates = await candidatesForTenant();
        const basic = candidates.find(
          (c) => c.scenarioRunId === ID.orphanBasic,
        );

        expect(basic).toBeDefined();
        expect(basic!.status).toBe(ScenarioRunStatus.QUEUED);
      });

      it("resolves per-run columns from the latest version via argMax, not a stale one", async () => {
        const candidates = await candidatesForTenant();
        const basic = candidates.find(
          (c) => c.scenarioRunId === ID.orphanBasic,
        );

        // Both versions carry a different ScenarioId; the returned value must be
        // the latest version's, proving argMax(col, UpdatedAt) over max(col).
        expect(basic!.scenarioId).toBe("scenario-latest");
      });

      it("includes a run whose latest version is QUEUED even though an earlier version was terminal", async () => {
        const candidates = await candidatesForTenant();
        const wasTerminal = candidates.find(
          (c) => c.scenarioRunId === ID.orphanWasTerminal,
        );

        // max(Status) would pick 'SUCCESS' and drop this run; argMax keeps the
        // latest QUEUED, so the HAVING filter admits it.
        expect(wasTerminal).toBeDefined();
        expect(wasTerminal!.status).toBe(ScenarioRunStatus.QUEUED);
      });

      it("excludes a run that recovered to a terminal status", async () => {
        const candidates = await candidatesForTenant();
        expect(
          candidates.some((c) => c.scenarioRunId === ID.recovered),
        ).toBe(false);
      });

      it("excludes a QUEUED run newer than the orphan cutoff", async () => {
        const candidates = await candidatesForTenant();
        expect(
          candidates.some((c) => c.scenarioRunId === ID.queuedRecent),
        ).toBe(false);
      });

      it("excludes an old run whose latest status is not QUEUED", async () => {
        const candidates = await candidatesForTenant();
        expect(
          candidates.some((c) => c.scenarioRunId === ID.terminalOld),
        ).toBe(false);
      });

      it("excludes a QUEUED run outside the lookback window", async () => {
        const candidates = await candidatesForTenant();
        expect(
          candidates.some((c) => c.scenarioRunId === ID.queuedAncient),
        ).toBe(false);
      });

      it("orders candidates oldest-first by last event time", async () => {
        const candidates = await candidatesForTenant();

        const lastEventTimes = candidates.map((c) => c.lastEventAtMs);
        const sortedAscending = [...lastEventTimes].sort((a, b) => a - b);
        expect(lastEventTimes).toEqual(sortedAscending);

        // The three seeded orphans, oldest last-event first: was-terminal
        // (~3h), basic (~2h), newest (~90m).
        const orphanOrder = candidates
          .map((c) => c.scenarioRunId)
          .filter((id) =>
            [ID.orphanWasTerminal, ID.orphanBasic, ID.orphanNewest].includes(
              id,
            ),
          );
        expect(orphanOrder).toEqual([
          ID.orphanWasTerminal,
          ID.orphanBasic,
          ID.orphanNewest,
        ]);
      });
    });
  });
});
