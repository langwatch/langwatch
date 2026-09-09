import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  createIngestionPullRunHandler,
  type IngestionPullOutcomeCommands,
} from "../ingestionPullEffects";
import { INGESTION_PULL_PROCESS_NAME } from "../ingestionPullProcess.types";

async function metricValue({
  name,
  labels,
}: {
  name: string;
  labels: Record<string, string>;
}): Promise<number> {
  const metric = register.getSingleMetric(name);
  if (!metric) return 0;
  const { values } = await metric.get();
  return (
    values.find((v) =>
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
    )?.value ?? 0
  );
}

const intent = {
  sourceId: "source-1",
  runId: "run-1",
  scheduledFor: 100,
  cursor: "cursor-1",
};

const context = (attempt: number): IntentContext => ({
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: "gov-project",
  processKey: "source-1",
  tenantId: "gov-project",
  messageKey: "process:source-1:pull:run-1",
  attempt,
});

function commandsStub(
  overrides: Partial<IngestionPullOutcomeCommands> = {},
): IngestionPullOutcomeCommands {
  return {
    recordRunCompleted: vi.fn(),
    recordRunFailed: vi.fn(),
    recordAgentsListed: vi.fn(),
    recordAgentsListingRefused: vi.fn(),
    recordPeopleListed: vi.fn(),
    recordPeopleListingRefused: vi.fn(),
    ...overrides,
  };
}

describe("ingestion pull outbox effect", () => {
  it("records a durable completion with the returned cursor", async () => {
    const recordRunCompleted = vi.fn();
    const handler = createIngestionPullRunHandler({
      agentListingPort: { list: () => Promise.reject(new Error("unused")) },
      peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
      runPort: {
        run: vi
          .fn()
          .mockResolvedValue({ nextCursor: "cursor-2", eventCount: 3 }),
      },
      commands: () => commandsStub({ recordRunCompleted }),
      clock: () => 200,
    });
    await handler(intent, context(1));
    expect(recordRunCompleted).toHaveBeenCalledWith({
      tenantId: "gov-project",
      occurredAt: 200,
      sourceId: "source-1",
      runId: "run-1",
      scheduledFor: 100,
      nextCursor: "cursor-2",
      eventCount: 3,
    });
  });

  it("reports the errors a partly-succeeded run stepped over", async () => {
    const recordRunCompleted = vi.fn();
    const handler = createIngestionPullRunHandler({
      agentListingPort: { list: () => Promise.reject(new Error("unused")) },
      peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
      runPort: {
        run: vi.fn().mockResolvedValue({
          nextCursor: "cursor-2",
          eventCount: 3,
          errorCount: 2,
        }),
      },
      commands: () => commandsStub({ recordRunCompleted }),
      clock: () => 200,
    });
    await handler(intent, context(1));
    expect(recordRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ eventCount: 3, errorCount: 2 }),
    );
  });

  it("rethrows before the final attempt so the outbox retries", async () => {
    const handler = createIngestionPullRunHandler({
      agentListingPort: { list: () => Promise.reject(new Error("unused")) },
      peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
      runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
      commands: () => commandsStub(),
    });
    await expect(handler(intent, context(1))).rejects.toThrow("provider down");
  });

  it("records a durable failure on the final attempt", async () => {
    const recordRunFailed = vi.fn();
    const handler = createIngestionPullRunHandler({
      agentListingPort: { list: () => Promise.reject(new Error("unused")) },
      peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
      runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
      commands: () => commandsStub({ recordRunFailed }),
      clock: () => 200,
    });
    await handler(intent, context(3));
    expect(recordRunFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "source-1",
        runId: "run-1",
        error: "provider down",
        errorCode: "pull_failed",
        // The final failure must not claim a retry is coming — retries are
        // exhausted; only the next scheduled run follows.
        retryable: false,
      }),
    );
  });

  it("does not translate a completion-command failure into a pull failure", async () => {
    const recordRunFailed = vi.fn();
    const handler = createIngestionPullRunHandler({
      agentListingPort: { list: () => Promise.reject(new Error("unused")) },
      peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
      runPort: {
        run: vi.fn().mockResolvedValue({ nextCursor: null, eventCount: 1 }),
      },
      commands: () =>
        commandsStub({
          recordRunCompleted: vi
            .fn()
            .mockRejectedValue(new Error("event log unavailable")),
          recordRunFailed,
        }),
    });

    await expect(handler(intent, context(3))).rejects.toThrow(
      "event log unavailable",
    );
    expect(recordRunFailed).not.toHaveBeenCalled();
  });
});

describe("pull outcome metrics (ADR-054)", () => {
  describe("when the final attempt fails", () => {
    it("counts a failed_final pull so the alert rule has a signal", async () => {
      const before = await metricValue({
        name: "ingestion_pull_total",
        labels: {
          outcome: "failed_final",
        },
      });
      const handler = createIngestionPullRunHandler({
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: () => commandsStub(),
        clock: () => 200,
      });

      await handler(intent, context(3));

      const after = await metricValue({
        name: "ingestion_pull_total",
        labels: {
          outcome: "failed_final",
        },
      });
      expect(after).toBe(before + 1);
    });
  });

  describe("when an attempt below the cap fails", () => {
    it("counts it as failed_retryable, never as a final failure", async () => {
      const beforeRetryable = await metricValue({
        name: "ingestion_pull_total",
        labels: {
          outcome: "failed_retryable",
        },
      });
      const beforeFinal = await metricValue({
        name: "ingestion_pull_total",
        labels: {
          outcome: "failed_final",
        },
      });
      const handler = createIngestionPullRunHandler({
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: () => commandsStub(),
        clock: () => 200,
      });

      await expect(handler(intent, context(1))).rejects.toThrow(
        "provider down",
      );

      expect(
        await metricValue({
          name: "ingestion_pull_total",
          labels: {
            outcome: "failed_retryable",
          },
        }),
      ).toBe(beforeRetryable + 1);
      expect(
        await metricValue({
          name: "ingestion_pull_total",
          labels: {
            outcome: "failed_final",
          },
        }),
      ).toBe(beforeFinal);
    });
  });

  /**
   * Spec: specs/ai-gateway/governance/ingestion-sources.feature
   *
   * The replacement records the abandonment because it is the only party that
   * knows both ids. The run it replaced ended when this one was minted, and
   * until this is written the history shows a run that started and no run that
   * ended — which reads on every screen as a source still working.
   */
  describe("given a run minted to replace one that outlived its allowance", () => {
    const replacing = {
      sourceId: "source-1",
      runId: "run-2",
      scheduledFor: 100,
      cursor: "cursor-1",
      abandonedRunId: "run-1",
    };

    /** @scenario "A run replaced before it finished records that it was abandoned" */
    it("records that the earlier run was abandoned", async () => {
      const recordRunFailed = vi.fn();
      const handler = createIngestionPullRunHandler({
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
        runPort: {
          run: vi.fn().mockResolvedValue({ nextCursor: "c2", eventCount: 0 }),
        },
        commands: () => commandsStub({ recordRunFailed }),
        clock: () => 200,
      });

      await handler(replacing, context(1));

      expect(recordRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", errorCode: "run_abandoned" }),
      );
    });

    /** @scenario "A run replaced before it finished records that it was abandoned" */
    it("records which run replaced it", async () => {
      const recordRunFailed = vi.fn();
      const handler = createIngestionPullRunHandler({
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
        runPort: {
          run: vi.fn().mockResolvedValue({ nextCursor: "c2", eventCount: 0 }),
        },
        commands: () => commandsStub({ recordRunFailed }),
        clock: () => 200,
      });

      await handler(replacing, context(1));

      expect(recordRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({ replacedByRunId: "run-2" }),
      );
    });

    it("records nothing about an abandonment on a run that replaced nothing", async () => {
      const recordRunFailed = vi.fn();
      const handler = createIngestionPullRunHandler({
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
        runPort: {
          run: vi.fn().mockResolvedValue({ nextCursor: "c2", eventCount: 0 }),
        },
        commands: () => commandsStub({ recordRunFailed }),
        clock: () => 200,
      });

      await handler(intent, context(1));

      expect(recordRunFailed).not.toHaveBeenCalled();
    });
  });

  /**
   * The wait leaves with the run. Every attempt has now been refused, so the
   * thing that must not walk back into the closed window is the next wake, and
   * it reads this off the connection rather than off the dead run.
   */
  describe("given a provider that refused every attempt and named a wait", () => {
    /** @scenario "A provider answering that too many requests were made has its wait read" */
    it("carries the wait onto the failure the connection reads", async () => {
      const recordRunFailed = vi.fn();
      const refusal = Object.assign(new Error("HTTP 429"), {
        retryAfterMs: 120_000,
      });
      const handler = createIngestionPullRunHandler({
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
        runPort: { run: vi.fn().mockRejectedValue(refusal) },
        commands: () => commandsStub({ recordRunFailed }),
        clock: () => 200,
        maxAttempts: 1,
      });

      await handler(intent, context(1));

      expect(recordRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({ retryAfterMs: 120_000 }),
      );
    });

    /** @scenario "A wait that cannot be read as a length of time is treated as no wait" */
    it("records no wait for a failure that named none", async () => {
      const recordRunFailed = vi.fn();
      const handler = createIngestionPullRunHandler({
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: () => commandsStub({ recordRunFailed }),
        clock: () => 200,
        maxAttempts: 1,
      });

      await handler(intent, context(1));

      expect(recordRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({ retryAfterMs: null }),
      );
    });
  });
});
