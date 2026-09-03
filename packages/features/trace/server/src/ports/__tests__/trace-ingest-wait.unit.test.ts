import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceQueryFieldValuesPort } from "../query-field-values.port";
import { TraceSummaryReaderPort } from "../trace-summary-reader.port";
import {
  TraceRepository,
  type TraceIngestLagSample,
  type TraceSpanPage,
  type TraceSpanSummaryRecord,
} from "../trace.port";
import { TraceService } from "../../services/trace.service";
import { TestModelProviderService } from "./support/model-provider.service.fake";
import { TestTraceQueryClassification } from "./support/query-classification.fake";
import { traceReadPorts } from "./support/trace-read-ports.fake";

class IngestLagRepository extends TraceRepository {
  readonly calls: string[] = [];
  sample: TraceIngestLagSample | null = null;
  failure: Error | null = null;

  findEvaluationSpans(): Promise<[]> {
    return Promise.resolve([]);
  }

  findEvaluationEvents(): Promise<[]> {
    return Promise.resolve([]);
  }

  async tryFindIngestLag(input: { tenantId: string }): Promise<TraceIngestLagSample | null> {
    this.calls.push(input.tenantId);
    if (this.failure) throw this.failure;
    return this.sample;
  }

  findSummaryPage(): Promise<TraceSpanPage> {
    return Promise.resolve({ rows: [], hasMore: false });
  }

  findSummarySince(): Promise<TraceSpanSummaryRecord[]> {
    return Promise.resolve([]);
  }
}

class EmptyQueryFields extends TraceQueryFieldValuesPort {
  list(): Promise<{ values: [] }> {
    return Promise.resolve({ values: [] });
  }
}

class NullSummaryReader extends TraceSummaryReaderPort {
  async tryGetSummary(): Promise<null> {
    return null;
  }
}

function createService(repository: TraceRepository): TraceService {
  return TraceService.create({
    repository,
    modelProviders: new TestModelProviderService(),
    queryFieldValues: new EmptyQueryFields(),
    queryClassification: new TestTraceQueryClassification(),
    summaryReader: new NullSummaryReader(),
    ...traceReadPorts(),
  });
}

describe("TraceService ingest wait", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a quarter more than p95 plus five seconds and rounds up", async () => {
    const repository = new IngestLagRepository();
    repository.sample = { p95LagMs: 6_000.1, sampleCount: 20 };

    await expect(
      createService(repository).resolveIngestWaitTimeout({ projectId: "project_1" }),
    ).resolves.toBe(12_501);
  });

  it.each([
    [{ p95LagMs: 0, sampleCount: 20 }, 10_000],
    [{ p95LagMs: 100_000, sampleCount: 20 }, 30_000],
  ] as const)("clamps %j to %i milliseconds", async (sample, expected) => {
    const repository = new IngestLagRepository();
    repository.sample = sample;

    await expect(
      createService(repository).resolveIngestWaitTimeout({ projectId: "project_1" }),
    ).resolves.toBe(expected);
  });

  it("uses the default until the repository has enough samples", async () => {
    const repository = new IngestLagRepository();
    repository.sample = { p95LagMs: 1_000, sampleCount: 19 };

    await expect(
      createService(repository).resolveIngestWaitTimeout({ projectId: "project_1" }),
    ).resolves.toBe(30_000);
  });

  it("does not cache a fallback after a repository failure", async () => {
    const repository = new IngestLagRepository();
    const service = createService(repository);
    repository.failure = new Error("ClickHouse unavailable");

    await expect(service.resolveIngestWaitTimeout({ projectId: "project_1" })).resolves.toBe(
      30_000,
    );

    repository.failure = null;
    repository.sample = { p95LagMs: 6_000, sampleCount: 20 };
    await expect(service.resolveIngestWaitTimeout({ projectId: "project_1" })).resolves.toBe(
      12_500,
    );
    expect(repository.calls).toEqual(["project_1", "project_1"]);
  });

  it("caches a measured value per project for one hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const repository = new IngestLagRepository();
    const service = createService(repository);
    repository.sample = { p95LagMs: 6_000, sampleCount: 20 };

    await service.resolveIngestWaitTimeout({ projectId: "project_1" });
    repository.sample = { p95LagMs: 12_000, sampleCount: 20 };
    await expect(service.resolveIngestWaitTimeout({ projectId: "project_1" })).resolves.toBe(
      12_500,
    );
    await expect(service.resolveIngestWaitTimeout({ projectId: "project_2" })).resolves.toBe(
      20_000,
    );

    vi.advanceTimersByTime(60 * 60 * 1_000 + 1);
    await expect(service.resolveIngestWaitTimeout({ projectId: "project_1" })).resolves.toBe(
      20_000,
    );
    expect(repository.calls).toEqual(["project_1", "project_2", "project_1"]);
  });
});
