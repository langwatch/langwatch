import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageStatsErrorReporter, UsageStatsTelemetryClient } from "../src";
import {
  type UsageStatsCollector,
  UsageStatsOrganizationRepository,
  type UsageStatsOrganization,
  type UsageStatsReport,
} from "../src/ports/usage-stats-worker.ports";
import {
  AnomalyWorkerContribution,
  UsageStatsWorkerContribution,
} from "../src/workers/ops-worker.contribution";

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

const DAY_MS = 24 * 60 * 60 * 1000;

class OrganizationsStub extends UsageStatsOrganizationRepository {
  readonly listForUsageStats = vi.fn<() => Promise<UsageStatsOrganization[]>>(
    async () => [],
  );
}

class UsageStatsStub implements UsageStatsCollector {
  readonly collect = vi.fn<
    (input: { organizationId: string }) => Promise<UsageStatsReport>
  >(async () => ({
    totalTraces: 0,
    totalScenarioEvents: 0,
    annotations: 0,
    annotationQueues: 0,
    annotationQueueItems: 0,
    annotationScores: 0,
    batchEvaluations: 0,
    customGraphs: 0,
    datasets: 0,
    datasetRecords: 0,
    experiments: 0,
    triggers: 0,
    workflows: 0,
    timestamp: "2026-08-25T00:00:00.000Z",
  }));
}

function usageStatsReport(overrides: Partial<UsageStatsReport> = {}): UsageStatsReport {
  return {
    totalTraces: 0,
    totalScenarioEvents: 0,
    annotations: 0,
    annotationQueues: 0,
    annotationQueueItems: 0,
    annotationScores: 0,
    batchEvaluations: 0,
    customGraphs: 0,
    datasets: 0,
    datasetRecords: 0,
    experiments: 0,
    triggers: 0,
    workflows: 0,
    timestamp: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

class TelemetryStub extends UsageStatsTelemetryClient {
  readonly send = vi.fn(async () => void 0);
}

class ErrorReporterStub extends UsageStatsErrorReporter {
  readonly capture = vi.fn(async () => void 0);
}

const createUsageStatsWorker = (disabled = false) => {
  const organizations = new OrganizationsStub();
  const usageStats = new UsageStatsStub();
  const telemetry = new TelemetryStub();
  const errors = new ErrorReporterStub();
  const worker = UsageStatsWorkerContribution.create({
    config: {
      disabled,
      installMethod: "self-hosted",
      hostname: "self-hosted.example",
      environment: "production",
      now: () => new Date(),
    },
    organizations,
    usageStats,
    telemetry,
    errors,
  });
  return { worker, organizations, usageStats, telemetry, errors };
};

describe("Ops worker contributions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts anomaly detection after the existing five-second settling delay", async () => {
    const detector = { tick: vi.fn(async () => ({ surfaced: 0, cleared: 0 })) };
    const handle = AnomalyWorkerContribution.create({ detector }).start();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(detector.tick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await handle.stop();
    expect(detector.tick).toHaveBeenCalledTimes(1);
  });

  it("retries a failed anomaly tick on its sixty-second interval", async () => {
    const detector = {
      tick: vi
        .fn<() => Promise<{ surfaced: number; cleared: number }>>()
        .mockRejectedValueOnce(new Error("redis unavailable"))
        .mockResolvedValue({ surfaced: 0, cleared: 0 }),
    };
    const handle = AnomalyWorkerContribution.create({ detector }).start();

    await vi.advanceTimersByTimeAsync(5_000 + 60_000);
    await handle.stop();

    expect(detector.tick).toHaveBeenCalledTimes(2);
  });

  it("sends each organization's exact self-hosted telemetry envelope at noon UTC", async () => {
    const { worker, organizations, usageStats, telemetry } = createUsageStatsWorker();
    organizations.listForUsageStats.mockResolvedValue([{ id: "org_1", name: "Acme" }]);
    const report = usageStatsReport({ totalTraces: 3, datasets: 2 });
    usageStats.collect.mockResolvedValue(report);
    const handle = worker.start();

    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    handle?.stop();

    expect(usageStats.collect).toHaveBeenCalledWith({ organizationId: "org_1" });
    expect(telemetry.send).toHaveBeenCalledWith({
      event: "daily_usage_stats",
      install_method: "self-hosted",
      hostname: "self-hosted.example",
      environment: "production",
      instance_id: "Acme__org_1",
      ...report,
    });
  });

  it("reports one organization failure and continues with the next organization", async () => {
    const { worker, organizations, usageStats, telemetry, errors } =
      createUsageStatsWorker();
    organizations.listForUsageStats.mockResolvedValue([
      { id: "org_1", name: "Acme" },
      { id: "org_2", name: "Baker" },
    ]);
    const failure = new Error("receiver unavailable");
    usageStats.collect.mockResolvedValue(usageStatsReport());
    telemetry.send.mockRejectedValueOnce(failure).mockResolvedValueOnce(void 0);
    const handle = worker.start();

    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    handle?.stop();

    expect(errors.capture).toHaveBeenCalledWith({
      instanceId: "Acme__org_1",
      error: failure,
    });
    expect(telemetry.send).toHaveBeenCalledTimes(2);
  });

  it("warns with the original error and retries a failed usage-stat tick", async () => {
    const { worker, organizations } = createUsageStatsWorker();
    const failure = new Error("database unavailable");
    organizations.listForUsageStats
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([]);
    const handle = worker.start();

    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    expect(logger.warn).toHaveBeenCalledWith(
      { error: failure },
      "usage stats tick failed (will retry on next interval)",
    );

    await vi.advanceTimersByTimeAsync(DAY_MS);
    handle?.stop();

    expect(organizations.listForUsageStats).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not schedule disabled usage telemetry", () => {
    const { worker, organizations } = createUsageStatsWorker(true);

    expect(worker.start()).toBeUndefined();
    expect(organizations.listForUsageStats).not.toHaveBeenCalled();
  });

  it("stops future usage-stat ticks", async () => {
    const { worker, organizations } = createUsageStatsWorker();
    const handle = worker.start();

    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    const ticksBeforeStop = organizations.listForUsageStats.mock.calls.length;
    handle?.stop();
    await vi.advanceTimersByTimeAsync(DAY_MS * 3);

    expect(organizations.listForUsageStats).toHaveBeenCalledTimes(ticksBeforeStop);
  });
});
