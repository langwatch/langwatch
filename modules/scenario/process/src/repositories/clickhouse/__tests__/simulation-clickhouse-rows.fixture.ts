/** One simulation_runs row builder, insert and per-tenant cleanup for the ClickHouse suites. */

import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, TenantGuard } from "@langwatch/clickhouse-client";
import { type VendorStatements, vendorQueryDriver } from "@langwatch/clickhouse-client/testing";
import { startMigratedAppReaderClickHouse } from "@langwatch/test-harness/clickhouse-app-reader";
import { nanoid } from "nanoid";
import { afterAll, beforeAll } from "vitest";

import {
  SCENARIO_ID_INDEXES,
  SCENARIO_SECOND_ID_INDEXES,
} from "../clickhouse.scenario-id-indexes.database.ts";
import {
  ClickHouseSimulationSession,
  type SimulationEventingClickHouseResolver,
} from "../clickhouse.simulation-session.store.ts";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

/** The app reader's credentials once a suite has opened the endpoint; reads then go out as it. */
let readerAuth: { username: string; password: string } | undefined;

/**
 * Scenario's migrated container with the app reader provisioned (ADR-202): its id indexes are
 * declared, `admin` seeds and cleans as the system, and every read built over a suite's
 * connection afterwards is sent as the reader.
 */
export async function startScenarioReaderClickHouse() {
  const opened = await startMigratedAppReaderClickHouse({
    suite: "scenario-migrated",
    indexes: [...SCENARIO_ID_INDEXES, ...SCENARIO_SECOND_ID_INDEXES],
    environment: process.env,
  });
  const url = new URL(opened.readerUrl);
  readerAuth = {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
  return opened;
}

export function simulationRunRow({
  tenantId,
  scenarioSetId,
  batchRunId,
  metadata,
  startedAt = new Date(Date.now() - 5000),
}: {
  tenantId: string;
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

/** Opens a client before the suite and deletes the tenant's rows after it. */
export function useSimulationClickHouse({ tenantId }: { tenantId: string }) {
  let client: ClickHouseClient | undefined;
  let repo: SimulationClickHouseRepository | undefined;

  beforeAll(async () => {
    const opened = (await startScenarioReaderClickHouse()).admin;
    client = opened;
    repo = simulationRepositoryOver(opened);
  });

  afterAll(async () => {
    if (!client) return;
    await client.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    client = undefined;
  });

  return {
    get client() {
      if (!client) throw new Error("ClickHouse integration environment is unavailable");
      return client;
    },
    get repo() {
      if (!repo) throw new Error("ClickHouse integration environment is unavailable");
      return repo;
    },
    async insertRows(rows: readonly Record<string, unknown>[]) {
      if (!client) throw new Error("ClickHouse integration environment is unavailable");
      await client.insert({
        table: "simulation_runs",
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    },
  };
}

/**
 * Scenario's own read path over a suite's connection: the process's client with scenario's id
 * indexes declared, one tenant's session per resolve, so an id-bound read expands its marker.
 */
export function scenarioClickHouseOver(
  vendor: VendorStatements,
): SimulationEventingClickHouseResolver {
  return ClickHouseSimulationSession.resolver(scenarioQueryClientOver(vendor));
}

/** The simulation repository over a suite's connection: tenant sessions, the reader for sets. */
export function simulationRepositoryOver(vendor: VendorStatements): SimulationClickHouseRepository {
  const clickhouse = scenarioQueryClientOver(vendor);
  return SimulationClickHouseRepository.create({
    sessions: ClickHouseSimulationSession.resolver(clickhouse),
    clickhouse,
  });
}

/** A connection whose reads carry the reader's credentials; the rest stays as it is. */
function asReader({
  vendor,
  auth,
}: {
  vendor: VendorStatements;
  auth: { username: string; password: string };
}): VendorStatements {
  return {
    query: (params) => {
      const asTheReader = { ...params, auth };
      return vendor.query(asTheReader);
    },
    insert: (params) => vendor.insert(params),
    command: (params) => vendor.command(params),
  };
}

function scenarioQueryClientOver(vendor: VendorStatements) {
  const clickhouse = new ClickHouseQueryClient({
    driver: vendorQueryDriver({ vendor }),
    ...(readerAuth === undefined
      ? {}
      : { readerDriver: vendorQueryDriver({ vendor: asReader({ vendor, auth: readerAuth }) }) }),
    tenantGuard: new TenantGuard(),
  });
  clickhouse.declareIdIndexes({ indexes: [...SCENARIO_ID_INDEXES, ...SCENARIO_SECOND_ID_INDEXES] });
  return clickhouse;
}
