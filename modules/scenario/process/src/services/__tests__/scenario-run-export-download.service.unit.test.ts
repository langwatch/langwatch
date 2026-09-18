/**
 * The download application owns the wire compression and attributed side effects.
 * @vitest-environment node
 */
import { gunzipSync } from "node:zlib";

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import {
  ScenarioRunStatus,
  type SimulationExportRun,
  type SimulationService,
  Verdict,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ScenarioRunExportDownloadService } from "../scenario-run-export-download.service.ts";
import { ScenarioRunExportService } from "../scenario-run-export.service.ts";

function run(): SimulationExportRun {
  return {
    scenarioRunId: "run_1",
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioSetId: "set_1",
    name: "Refund request",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      reasoning: "The agent offered a refund.",
      metCriteria: ["stays polite"],
      unmetCriteria: [],
      error: undefined,
    },
    messages: [],
    traceIds: [],
    timestamp: 1785177315009,
    updatedAt: 1785177315009,
    durationInMs: 8400,
    totalCost: 0.031,
  };
}

async function bytes(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);

  return Buffer.concat(chunks);
}

describe("ScenarioRunExportDownloadService", () => {
  /** @scenario "The scenario-runs download is attributed and compressed" */
  it("audits the viewer, streams canonical CSV as gzip, and publishes progress", async () => {
    const audit = vi.fn<AuditLogApi["record"]>().mockResolvedValue();
    const publish = vi.fn<PresenceApi["publishProjectEvent"]>().mockResolvedValue();
    const simulations = createApiFixture<SimulationService>({
      countRunsForExport: async () => 1,
      findRunsForExport: async () => ({ runs: [run()], hasMore: false }),
    });
    const service = ScenarioRunExportDownloadService.create({
      auditLog: createApiFixture<AuditLogApi>({ record: audit }),
      exports: ScenarioRunExportService.create(simulations),
      presence: createApiFixture<PresenceApi>({ publishProjectEvent: publish }),
    });

    const download = await service.download({
      request: { projectId: "project_1", mode: "full" },
      userId: "user_1",
    });
    const csv = gunzipSync(await bytes(download.stream)).toString();

    expect(csv).toContain("run_scenario_run_id");
    expect(csv).toContain("run_1");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        projectId: "project_1",
        action: "scenarioRuns.export",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        channel: "export_progress",
        event: expect.stringContaining('"type":"progress"'),
      }),
    );
  });

  /** @scenario "Cancelling an export prevents the CSV sweep from starting" */
  it("does not count or fetch runs when the request was already cancelled", async () => {
    const countRunsForExport = vi.fn<SimulationService["countRunsForExport"]>();
    const findRunsForExport = vi.fn<SimulationService["findRunsForExport"]>();
    const controller = new AbortController();
    controller.abort(new Error("client disconnected"));
    const service = ScenarioRunExportDownloadService.create({
      auditLog: createApiFixture<AuditLogApi>({ record: async () => {} }),
      exports: ScenarioRunExportService.create(
        createApiFixture<SimulationService>({ countRunsForExport, findRunsForExport }),
      ),
      presence: createApiFixture<PresenceApi>({ publishProjectEvent: async () => {} }),
    });

    await expect(
      service.download({
        request: { projectId: "project_1", mode: "full" },
        userId: "user_1",
        signal: controller.signal,
      }),
    ).rejects.toThrow("client disconnected");

    expect(countRunsForExport).not.toHaveBeenCalled();
    expect(findRunsForExport).not.toHaveBeenCalled();
  });

  /** @scenario "Cancelling an in-flight export stops additional CSV pages" */
  it("cancels the source stream before it can request another export page", async () => {
    let resolveFirstPage: (value: { runs: SimulationExportRun[]; hasMore: boolean }) => void;
    const firstPage = new Promise<{ runs: SimulationExportRun[]; hasMore: boolean }>((resolve) => {
      resolveFirstPage = resolve;
    });
    const findRunsForExport = vi
      .fn<SimulationService["findRunsForExport"]>()
      .mockReturnValue(firstPage);
    const service = ScenarioRunExportDownloadService.create({
      auditLog: createApiFixture<AuditLogApi>({ record: async () => {} }),
      exports: ScenarioRunExportService.create(
        createApiFixture<SimulationService>({
          countRunsForExport: async () => 2,
          findRunsForExport,
        }),
      ),
      presence: createApiFixture<PresenceApi>({ publishProjectEvent: async () => {} }),
    });

    const download = await service.download({
      request: { projectId: "project_1", mode: "full" },
      userId: "user_1",
    });
    await vi.waitFor(() => expect(findRunsForExport).toHaveBeenCalledTimes(1));

    await download.cancel(new Error("client disconnected"));
    resolveFirstPage!({ runs: [run()], hasMore: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(findRunsForExport).toHaveBeenCalledTimes(1);
  });
});
