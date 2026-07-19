import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import {
  createIngestionPullIntentHandlers,
  INGESTION_PULL_PROCESS_INTENT_TYPES,
} from "..";

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

const message = (attempt: number) => ({
  processName: "ingestionPull",
  projectId: "gov-project",
  processKey: "source-1",
  tenantId: "gov-project",
  messageKey: "pull:source-1:run-1",
  intentType: INGESTION_PULL_PROCESS_INTENT_TYPES.RUN,
  sourceEventId: null,
  attempt,
  payload: {
    sourceId: "source-1",
    runId: "run-1",
    scheduledFor: 100,
    cursor: "cursor-1",
  },
});

describe("ingestion pull outbox effect", () => {
  it("records a durable completion with the returned cursor", async () => {
    const recordRunCompleted = vi.fn();
    const handlers = createIngestionPullIntentHandlers({
      runPort: {
        run: vi
          .fn()
          .mockResolvedValue({ nextCursor: "cursor-2", eventCount: 3 }),
      },
      commands: { recordRunCompleted, recordRunFailed: vi.fn() },
      clock: () => 200,
    });
    await handlers[INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]!({
      message: message(1),
    });
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
    const handlers = createIngestionPullIntentHandlers({
      runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
      commands: { recordRunCompleted: vi.fn(), recordRunFailed: vi.fn() },
    });
    await expect(
      handlers[INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]!({
        message: message(1),
      }),
    ).rejects.toThrow("provider down");
  });

  it("records a durable failure on the final attempt", async () => {
    const recordRunFailed = vi.fn();
    const handlers = createIngestionPullIntentHandlers({
      runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
      commands: { recordRunCompleted: vi.fn(), recordRunFailed },
      clock: () => 200,
    });
    await handlers[INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]!({
      message: message(3),
    });
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
    const handlers = createIngestionPullIntentHandlers({
      runPort: {
        run: vi.fn().mockResolvedValue({ nextCursor: null, eventCount: 1 }),
      },
      commands: {
        recordRunCompleted: vi
          .fn()
          .mockRejectedValue(new Error("event log unavailable")),
        recordRunFailed,
      },
    });

    await expect(
      handlers[INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]!({
        message: message(3),
      }),
    ).rejects.toThrow("event log unavailable");
    expect(recordRunFailed).not.toHaveBeenCalled();
  });
});

describe("pull outcome metrics (ADR-054)", () => {
  describe("when the final attempt fails", () => {
    it("counts a failed_final pull so the alert rule has a signal", async () => {
      const before = await metricValue("ingestion_pull_total", {
        outcome: "failed_final",
      });
      const handlers = createIngestionPullIntentHandlers({
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: { recordRunCompleted: vi.fn(), recordRunFailed: vi.fn() },
        clock: () => 200,
      });

      await handlers[INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]!({
        message: message(3),
      });

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
      const handlers = createIngestionPullIntentHandlers({
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: { recordRunCompleted: vi.fn(), recordRunFailed: vi.fn() },
        clock: () => 200,
      });

      await expect(
        handlers[INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]!({
          message: message(1),
        }),
      ).rejects.toThrow("provider down");

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
