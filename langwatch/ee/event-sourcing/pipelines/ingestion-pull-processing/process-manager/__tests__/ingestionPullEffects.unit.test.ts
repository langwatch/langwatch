import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  createIngestionPullRunHandler,
  type IngestionPullOutcomeCommands,
} from "../ingestionPullEffects";
import {
  INGESTION_PULL_PROCESS_INTENT_TYPES,
  INGESTION_PULL_PROCESS_NAME,
} from "../ingestionPullProcess.types";

async function metricValue(
  name: string,
  labels: Record<string, string>,
): Promise<number> {
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
  intentType: INGESTION_PULL_PROCESS_INTENT_TYPES.RUN,
  attempt,
});

function commandsStub(
  overrides: Partial<IngestionPullOutcomeCommands> = {},
): IngestionPullOutcomeCommands {
  return {
    recordRunCompleted: vi.fn(),
    recordRunFailed: vi.fn(),
    ...overrides,
  };
}

describe("ingestion pull outbox effect", () => {
  it("records a durable completion with the returned cursor", async () => {
    const recordRunCompleted = vi.fn();
    const handler = createIngestionPullRunHandler({
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

  it("rethrows before the final attempt so the outbox retries", async () => {
    const handler = createIngestionPullRunHandler({
      runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
      commands: () => commandsStub(),
    });
    await expect(handler(intent, context(1))).rejects.toThrow("provider down");
  });

  it("records a durable failure on the final attempt", async () => {
    const recordRunFailed = vi.fn();
    const handler = createIngestionPullRunHandler({
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
      }),
    );
  });

  it("does not translate a completion-command failure into a pull failure", async () => {
    const recordRunFailed = vi.fn();
    const handler = createIngestionPullRunHandler({
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
      const before = await metricValue("ingestion_pull_total", {
        outcome: "failed_final",
      });
      const handler = createIngestionPullRunHandler({
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: () => commandsStub(),
        clock: () => 200,
      });

      await handler(intent, context(3));

      const after = await metricValue("ingestion_pull_total", {
        outcome: "failed_final",
      });
      expect(after).toBe(before + 1);
    });
  });

  describe("when an attempt below the cap fails", () => {
    it("counts it as failed_retryable, never as a final failure", async () => {
      const beforeRetryable = await metricValue("ingestion_pull_total", {
        outcome: "failed_retryable",
      });
      const beforeFinal = await metricValue("ingestion_pull_total", {
        outcome: "failed_final",
      });
      const handler = createIngestionPullRunHandler({
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: () => commandsStub(),
        clock: () => 200,
      });

      await expect(handler(intent, context(1))).rejects.toThrow(
        "provider down",
      );

      expect(
        await metricValue("ingestion_pull_total", {
          outcome: "failed_retryable",
        }),
      ).toBe(beforeRetryable + 1);
      expect(
        await metricValue("ingestion_pull_total", {
          outcome: "failed_final",
        }),
      ).toBe(beforeFinal);
    });
  });
});
