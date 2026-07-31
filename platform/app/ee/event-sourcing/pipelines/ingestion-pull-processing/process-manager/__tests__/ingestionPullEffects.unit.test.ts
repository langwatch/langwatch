import type { HandlerContext } from "@langwatch/event-sourcing";
import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import {
  type IngestionPullOutcomeCommands,
  ingestionPullIntents,
} from "../ingestionPullEffects";

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

const ctx: HandlerContext = { now: 200, tenantId: "gov-project" };

function commandsStub(
  overrides: Partial<IngestionPullOutcomeCommands> = {},
): IngestionPullOutcomeCommands {
  return {
    recordRunCompleted: vi.fn(),
    recordRunFailed: vi.fn(),
    ...overrides,
  };
}

describe("the ingestion pull run intent", () => {
  it("records a durable completion with the returned cursor", async () => {
    const recordRunCompleted = vi.fn();
    const intents = ingestionPullIntents({
      runPort: {
        run: vi
          .fn()
          .mockResolvedValue({ nextCursor: "cursor-2", eventCount: 3 }),
      },
      commands: commandsStub({ recordRunCompleted }),
      clock: () => 200,
    });

    await intents.run.deliver(intent, ctx);

    expect(recordRunCompleted).toHaveBeenCalledWith(
      {
        occurredAt: 200,
        sourceId: "source-1",
        runId: "run-1",
        scheduledFor: 100,
        nextCursor: "cursor-2",
        eventCount: 3,
      },
      { tenantId: "gov-project" },
    );
  });

  describe("when the provider fails", () => {
    it("records a durable failure the next cron wake retries past", async () => {
      const recordRunFailed = vi.fn();
      const intents = ingestionPullIntents({
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: commandsStub({ recordRunFailed }),
        clock: () => 200,
      });

      await intents.run.deliver(intent, ctx);

      expect(recordRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: "source-1",
          runId: "run-1",
          error: "provider down",
          errorCode: "pull_failed",
          // Nothing retries THIS run; only the next scheduled one follows.
          retryable: false,
        }),
        { tenantId: "gov-project" },
      );
    });
  });

  it("does not translate a completion-command failure into a pull failure", async () => {
    const recordRunFailed = vi.fn();
    const intents = ingestionPullIntents({
      runPort: {
        run: vi.fn().mockResolvedValue({ nextCursor: null, eventCount: 1 }),
      },
      commands: commandsStub({
        recordRunCompleted: vi
          .fn()
          .mockRejectedValue(new Error("event log unavailable")),
        recordRunFailed,
      }),
    });

    await expect(intents.run.deliver(intent, ctx)).rejects.toThrow(
      "event log unavailable",
    );
    expect(recordRunFailed).not.toHaveBeenCalled();
  });

  describe("given two runs of the same source", () => {
    it("keys each dispatch on its own run so neither collapses onto the other", () => {
      const intents = ingestionPullIntents({
        runPort: { run: vi.fn() },
        commands: commandsStub(),
      });

      expect(intents.run.messageKey(intent)).toBe("pull:source-1:run-1");
      expect(intents.run.messageKey({ ...intent, runId: "run-2" })).toBe(
        "pull:source-1:run-2",
      );
    });
  });
});

describe("pull outcome metrics (ADR-054)", () => {
  describe("when a pull fails", () => {
    it("counts a failed_final pull so the alert rule has a signal", async () => {
      const before = await metricValue({
        name: "ingestion_pull_total",
        labels: { outcome: "failed_final" },
      });
      const intents = ingestionPullIntents({
        runPort: { run: vi.fn().mockRejectedValue(new Error("provider down")) },
        commands: commandsStub(),
        clock: () => 200,
      });

      await intents.run.deliver(intent, ctx);

      expect(
        await metricValue({
          name: "ingestion_pull_total",
          labels: { outcome: "failed_final" },
        }),
      ).toBe(before + 1);
    });
  });

  describe("when a pull lands", () => {
    it("counts it as completed and never as a failure", async () => {
      const beforeCompleted = await metricValue({
        name: "ingestion_pull_total",
        labels: { outcome: "completed" },
      });
      const beforeFinal = await metricValue({
        name: "ingestion_pull_total",
        labels: { outcome: "failed_final" },
      });
      const intents = ingestionPullIntents({
        runPort: {
          run: vi.fn().mockResolvedValue({ nextCursor: null, eventCount: 0 }),
        },
        commands: commandsStub(),
        clock: () => 200,
      });

      await intents.run.deliver(intent, ctx);

      expect(
        await metricValue({
          name: "ingestion_pull_total",
          labels: { outcome: "completed" },
        }),
      ).toBe(beforeCompleted + 1);
      expect(
        await metricValue({
          name: "ingestion_pull_total",
          labels: { outcome: "failed_final" },
        }),
      ).toBe(beforeFinal);
    });
  });
});
