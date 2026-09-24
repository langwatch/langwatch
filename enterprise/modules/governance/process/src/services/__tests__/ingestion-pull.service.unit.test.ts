import {
  PULL_FAILED_ERROR_CODE,
  PULL_REFUSED_ERROR_CODE,
} from "@langwatch/enterprise-governance-contract";
import { DispatchError } from "@langwatch/eventing";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import type {
  IngestionPullMetricsSink,
  IngestionPullOutcomeChannel,
  IngestionPullRun,
  IngestionPullRunResult,
} from "../../app/governance.members.ts";
import { IngestionPullService } from "../ingestion-pull.service.ts";

type Failed = Parameters<IngestionPullOutcomeChannel["failed"]>[0];
type Completed = Parameters<IngestionPullOutcomeChannel["completed"]>[0];

class RecordingOutcome implements IngestionPullOutcomeChannel {
  readonly completedCalls: Completed[] = [];
  readonly failedCalls: Failed[] = [];
  async completed(input: Completed): Promise<void> {
    this.completedCalls.push(input);
  }
  async failed(input: Failed): Promise<void> {
    this.failedCalls.push(input);
  }
}

class NoMetrics implements IngestionPullMetricsSink {
  count(): void {}
  observeDuration(): void {}
}

function pullService(run: () => Promise<IngestionPullRunResult>) {
  const outcome = new RecordingOutcome();
  const service = IngestionPullService.create({
    runPort: { run },
    outcomePort: outcome,
    metrics: new NoMetrics(),
    options: { clock: () => 7_000, logger: createTestLogger().logger },
  });
  return { service, outcome };
}

const pull = (overrides: Partial<IngestionPullRun> = {}): IngestionPullRun => ({
  sourceId: "source-1",
  runId: "run-2",
  scheduledFor: 5_000,
  cursor: "cursor-1",
  ...overrides,
});

describe("given a run that took over from one that outlived its allowance", () => {
  /** @scenario "A run replaced before it finished records that it was abandoned" */
  it("records the abandonment naming the replacement before asking the provider", async () => {
    const { service, outcome } = pullService(async () => ({ nextCursor: "c2", eventCount: 1 }));
    await service.execute({ tenantId: "project-1", attempt: 1, pull: pull({ abandonedRunId: "run-1" }) });

    expect(outcome.failedCalls).toEqual([
      expect.objectContaining({
        runId: "run-1",
        errorCode: "run_abandoned",
        retryable: false,
        replacedByRunId: "run-2",
      }),
    ]);
    expect(outcome.completedCalls).toMatchObject([{ runId: "run-2", nextCursor: "c2" }]);
  });
});

describe("given a provider that says too many requests were made", () => {
  /** @scenario "A provider that says too many requests were made is asked only once in that run" */
  it("ends the run on the first attempt and carries away the wait it named", async () => {
    const { service, outcome } = pullService(() =>
      Promise.reject(
        new DispatchError({ message: "429 from provider", retryable: false, retryAfterMs: 60_000 }),
      ),
    );
    await service.execute({ tenantId: "project-1", attempt: 1, pull: pull() });

    expect(outcome.failedCalls).toEqual([
      expect.objectContaining({
        runId: "run-2",
        errorCode: PULL_FAILED_ERROR_CODE,
        retryable: false,
        retryAfterMs: 60_000,
      }),
    ]);
  });

  it("pairs the refused code only with a sentence we wrote", async () => {
    const { service, outcome } = pullService(() =>
      Promise.reject(
        new DispatchError({
          message: "401 body",
          retryable: false,
          customerMessage: "The key was revoked.",
        }),
      ),
    );
    await service.execute({ tenantId: "project-1", attempt: 1, pull: pull() });

    expect(outcome.failedCalls).toMatchObject([
      { errorCode: PULL_REFUSED_ERROR_CODE, error: "The key was revoked.", retryAfterMs: null },
    ]);
  });
});

describe("given a transport failure", () => {
  it("rethrows while attempts remain", async () => {
    const { service, outcome } = pullService(() => Promise.reject(new Error("reset")));

    await expect(service.execute({ tenantId: "project-1", attempt: 1, pull: pull() })).rejects.toThrow(
      "reset",
    );
    expect(outcome.failedCalls).toEqual([]);
  });

  it("records pull_failed once attempts are spent", async () => {
    const { service, outcome } = pullService(() => Promise.reject(new Error("reset")));
    await service.execute({ tenantId: "project-1", attempt: 3, pull: pull() });

    expect(outcome.failedCalls).toMatchObject([
      { errorCode: PULL_FAILED_ERROR_CODE, error: "reset", retryAfterMs: null },
    ]);
  });
});
