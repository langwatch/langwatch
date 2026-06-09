import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestContainers, stopTestContainers } from "../../../event-sourcing/__tests__/integration/testContainers";

// getRun resolves its ClickHouse client through getClickHouseClientForProject;
// point that at the testcontainer client so the real query path runs.
let testClient: ClickHouseClient;
vi.mock("~/server/clickhouse/clickhouseClient", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("~/server/clickhouse/clickhouseClient")
  >();
  return {
    ...actual,
    getClickHouseClientForProject: async () => testClient,
  };
});

// Imported after the mock is registered.
const { ClickHouseExperimentRunService } = await import(
  "../clickhouse-experiment-run.service"
);

const tenantId = `test-exp-getrun-${nanoid()}`;

interface RunVersion {
  tenant?: string;
  experimentId: string;
  runId: string;
  progress: number;
  total?: number;
  targets?: string;
  /** Seconds subtracted from now64(3) for UpdatedAt; lower = newer. */
  agoSec: number;
}

/**
 * Inserts one experiment_runs version using server-side now64(3) timestamps,
 * synchronously via a command (avoids client-side Date serialization and async
 * insert buffering). Only the columns the read path needs are set; the rest
 * take their table defaults.
 */
async function insertVersion(ch: ClickHouseClient, v: RunVersion) {
  await ch.command({
    query: `
      INSERT INTO experiment_runs
        (ProjectionId, TenantId, RunId, ExperimentId, Version, Total, Progress, Targets, CreatedAt, UpdatedAt, StartedAt)
      VALUES
        ({pid:String}, {tenant:String}, {runId:String}, {experimentId:String}, 'v1', {total:UInt32}, {progress:UInt32}, {targets:String}, now64(3), now64(3) - {agoSec:UInt32}, now64(3))
    `,
    query_params: {
      pid: nanoid(),
      tenant: v.tenant ?? tenantId,
      runId: v.runId,
      experimentId: v.experimentId,
      total: v.total ?? 10,
      progress: v.progress,
      targets: v.targets ?? "[]",
      agoSec: v.agoSec,
    },
  });
}

let ch: ClickHouseClient;
let service: InstanceType<typeof ClickHouseExperimentRunService>;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  testClient = ch;
  service = new ClickHouseExperimentRunService({} as any);
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE experiment_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("ClickHouseExperimentRunService.getRun (integration)", () => {
  describe("when a run has several versions", () => {
    it("returns the fields of the version with the greatest UpdatedAt", async () => {
      const experimentId = `exp-latest-${nanoid()}`;
      const runId = `run-latest-${nanoid()}`;
      await insertVersion(ch, { experimentId, runId, progress: 1, targets: '[{"id":"stale-1"}]', agoSec: 3 });
      await insertVersion(ch, { experimentId, runId, progress: 2, targets: '[{"id":"stale-2"}]', agoSec: 1 });
      await insertVersion(ch, { experimentId, runId, progress: 9, targets: '[{"id":"final"}]', agoSec: 0 });

      const result = await service.getRun({ projectId: tenantId, experimentId, runId });

      expect(result).not.toBeNull();
      expect(result!.progress).toBe(9);
      expect(result!.targets).toEqual([{ id: "final" }]);
    });
  });

  describe("when the run does not exist", () => {
    it("returns null", async () => {
      const result = await service.getRun({
        projectId: tenantId,
        experimentId: `exp-missing-${nanoid()}`,
        runId: `run-missing-${nanoid()}`,
      });
      expect(result).toBeNull();
    });
  });

  describe("when the same run id exists under another tenant", () => {
    it("does not return the other tenant's run", async () => {
      const experimentId = `exp-shared-${nanoid()}`;
      const runId = `run-shared-${nanoid()}`;
      const otherTenant = `test-exp-getrun-other-${nanoid()}`;
      await insertVersion(ch, { tenant: otherTenant, experimentId, runId, progress: 5, agoSec: 0 });

      const result = await service.getRun({ projectId: tenantId, experimentId, runId });
      expect(result).toBeNull();

      await ch.exec({
        query: `ALTER TABLE experiment_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: otherTenant },
      });
    });
  });
});
