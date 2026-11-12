import type { Authorization } from "@langwatch/authorization";
import { ownProjectIdOf } from "@langwatch/clickhouse-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestModelProviderService } from "../../__tests__/support/model-provider.service.fake.ts";
import { TestTraceQueryClassification } from "../../__tests__/support/query-classification.fake.ts";
import { traceReadPorts } from "../../__tests__/support/trace-read-ports.fake.ts";
import { TraceQueryFieldValuesRepository } from "../../features/query/repositories/query-field-values.repository.ts";
import {
  TraceProjectedReadRepository,
  type TraceIngestLagSample,
  type TraceSpanPage,
  type TraceSpanSummaryRecord,
} from "../../repositories/trace-projected-read.repository.ts";
import { TraceSummaryReaderRepository } from "../../repositories/trace-summary-reader.repository.ts";
import { TraceService } from "../trace.service.ts";

class IngestLagRepository extends TraceProjectedReadRepository {
  readonly calls: string[] = [];
  sample: TraceIngestLagSample | null = null;
  failure: Error | null = null;

  findEvaluationSpans(): Promise<[]> {
    return Promise.resolve([]);
  }

  findEvaluationEvents(): Promise<[]> {
    return Promise.resolve([]);
  }

  async findIngestLag(input: {
    authorization: Authorization;
  }): Promise<TraceIngestLagSample | null> {
    this.calls.push(ownProjectIdOf({ authorization: input.authorization, reads: "traces" }));
    if (this.failure) throw this.failure;
    return this.sample;
  }

  listSummaryPage(): Promise<TraceSpanPage> {
    return Promise.resolve({ rows: [], hasMore: false });
  }

  findSummarySince(): Promise<TraceSpanSummaryRecord[]> {
    return Promise.resolve([]);
  }
}

class EmptyQueryFields extends TraceQueryFieldValuesRepository {
  findAll(): Promise<{ values: [] }> {
    return Promise.resolve({ values: [] });
  }
}

class NullSummaryReaderRepository extends TraceSummaryReaderRepository {
  async findSummary(): Promise<null> {
    return null;
  }
}

function createService(repository: TraceProjectedReadRepository): TraceService {
  return TraceService.create({
    repository,
    modelProviders: new TestModelProviderService(),
    queryFieldValues: new EmptyQueryFields(),
    queryClassification: new TestTraceQueryClassification(),
    summaryReader: new NullSummaryReaderRepository(),
    ...traceReadPorts(),
  });
}

describe("TraceService ingest wait", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "The wait budget grows with the project's measured ingest lag" */
  /** @scenario "The wait budget rounds up, never down" */
  it("uses a quarter more than p95 plus five seconds and rounds up", async () => {
    const repository = new IngestLagRepository();
    repository.sample = {
      p95LagMs: 6_000.1,
      sampleCount: 20,
      p95ArrivalGapMs: null,
      arrivalGapSampleCount: 0,
    };

    await expect(
      createService(repository).resolveIngestWaitTimeout({ projectId: "project_1" }),
    ).resolves.toBe(12_501);
  });

  /** @scenario "The wait budget stays within its floor and ceiling" */
  it.each([
    [{ p95LagMs: 0, sampleCount: 20, p95ArrivalGapMs: null, arrivalGapSampleCount: 0 }, 10_000],
    [
      { p95LagMs: 100_000, sampleCount: 20, p95ArrivalGapMs: null, arrivalGapSampleCount: 0 },
      30_000,
    ],
  ] as const)("clamps %j to %i milliseconds", async (sample, expected) => {
    const repository = new IngestLagRepository();
    repository.sample = sample;

    await expect(
      createService(repository).resolveIngestWaitTimeout({ projectId: "project_1" }),
    ).resolves.toBe(expected);
  });

  /** @scenario "A project with few recent traces gets the default wait budget" */
  it("uses the default until the repository has enough samples", async () => {
    const repository = new IngestLagRepository();
    repository.sample = {
      p95LagMs: 1_000,
      sampleCount: 19,
      p95ArrivalGapMs: null,
      arrivalGapSampleCount: 0,
    };

    await expect(
      createService(repository).resolveIngestWaitTimeout({ projectId: "project_1" }),
    ).resolves.toBe(30_000);
  });

  /** @scenario "A failed ingest lag measurement never fails the run" */
  it("does not cache a fallback after a repository failure", async () => {
    const repository = new IngestLagRepository();
    const service = createService(repository);
    repository.failure = new Error("ClickHouse unavailable");

    await expect(service.resolveIngestWaitTimeout({ projectId: "project_1" })).resolves.toBe(
      30_000,
    );

    repository.failure = null;
    repository.sample = {
      p95LagMs: 6_000,
      sampleCount: 20,
      p95ArrivalGapMs: null,
      arrivalGapSampleCount: 0,
    };
    await expect(service.resolveIngestWaitTimeout({ projectId: "project_1" })).resolves.toBe(
      12_500,
    );
    expect(repository.calls).toEqual(["project_1", "project_1"]);
  });

  /** @scenario "A measured wait budget is reused for an hour" */
  it("caches a measured value per project for one hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const repository = new IngestLagRepository();
    const service = createService(repository);
    repository.sample = {
      p95LagMs: 6_000,
      sampleCount: 20,
      p95ArrivalGapMs: null,
      arrivalGapSampleCount: 0,
    };

    await service.resolveIngestWaitTimeout({ projectId: "project_1" });
    repository.sample = {
      p95LagMs: 12_000,
      sampleCount: 20,
      p95ArrivalGapMs: null,
      arrivalGapSampleCount: 0,
    };
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

describe("TraceService settle settings", () => {
  const measured = (p95ArrivalGapMs: number | null, arrivalGapSampleCount = 20) => ({
    p95LagMs: 6_000,
    sampleCount: 20,
    p95ArrivalGapMs,
    arrivalGapSampleCount,
  });

  /** @scenario "The quiet period defaults to seven seconds" */
  it("answers the defaults for a project with no history", async () => {
    const repository = new IngestLagRepository();

    await expect(
      createService(repository).resolveTraceSettleSettings({ projectId: "project_1" }),
    ).resolves.toEqual({ waitTimeoutMs: 30_000, waitExtensionMs: 30_000, quietPeriodMs: 7_000 });
  });

  /** @scenario "A project whose spans arrive closer together keeps the default quiet period" */
  it("keeps seven seconds when the measured gap is shorter", async () => {
    const repository = new IngestLagRepository();
    repository.sample = measured(4_000);

    await expect(
      createService(repository).resolveTraceSettleSettings({ projectId: "project_1" }),
    ).resolves.toEqual({ waitTimeoutMs: 12_500, waitExtensionMs: 30_000, quietPeriodMs: 7_000 });
  });

  /** @scenario "A project whose spans arrive further apart gets a longer quiet period" */
  it("uses the measured gap when it is longer than the default", async () => {
    const repository = new IngestLagRepository();
    repository.sample = measured(12_000);

    await expect(
      createService(repository).resolveTraceSettleSettings({ projectId: "project_1" }),
    ).resolves.toMatchObject({ quietPeriodMs: 12_000 });
  });

  /** @scenario "The measured span arrival gap stays within its floor and ceiling" */
  it.each([
    [500, 7_000],
    [120_000, 30_000],
    [12_000.2, 12_001],
  ] as const)("clamps a %i ms gap to a %i ms quiet period", async (gap, expected) => {
    const repository = new IngestLagRepository();
    repository.sample = measured(gap);

    await expect(
      createService(repository).resolveTraceSettleSettings({ projectId: "project_1" }),
    ).resolves.toMatchObject({ quietPeriodMs: expected });
  });

  it("ignores a gap measured on too few traces", async () => {
    const repository = new IngestLagRepository();
    repository.sample = measured(20_000, 19);

    await expect(
      createService(repository).resolveTraceSettleSettings({ projectId: "project_1" }),
    ).resolves.toMatchObject({ quietPeriodMs: 7_000 });
  });
});
