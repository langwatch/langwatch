/**
 * @vitest-environment jsdom
 *
 * Renders the real StatStrip against an actual ChakraProvider. The latency
 * tiles' basis matters because P50/P99 here are computed over a rolling
 * completed-jobs sample, not a time window — an operator reading them as
 * "the last five minutes" during an incident would be misled in either
 * direction depending on throughput.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { DashboardData, PhaseMetrics } from "@langwatch/ops-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatStrip } from "../StatStrip";

// The dead-letters tile reads the process-outbox side through the same query
// the navigation badge uses; the strip itself is otherwise snapshot-driven.
const outboxDeadQuery = vi.fn(() => ({
  data: [{ processName: "webhookDelivery", count: 94, oldestUpdatedAt: 0 }] as
    | Array<{ processName: string; count: number; oldestUpdatedAt: number }>
    | undefined,
}));
vi.mock("~/utils/api", () => ({
  api: {
    ops: { listDeadLetterCounts: { useQuery: () => outboxDeadQuery() } },
  },
}));

const emptyPhase = (): PhaseMetrics => ({
  pending: 0,
  active: 0,
  completedPerSec: 0,
  failedPerSec: 0,
  latencyP50Ms: 0,
  latencyP99Ms: 0,
  peakCompletedPerSec: 0,
  peakFailedPerSec: 0,
  peakLatencyP50Ms: 0,
  peakLatencyP99Ms: 0,
});

const makeData = (overrides: Partial<DashboardData> = {}): DashboardData => ({
  totalGroups: 51,
  blockedGroups: 0,
  parkedGroups: 0,
  totalPendingJobs: 0,
  pendingDrift: 0,
  throughputIngestedPerSec: 10,
  totalCompleted: 1_000,
  totalFailed: 0,
  completedPerSec: 10,
  failedPerSec: 0,
  peakCompletedPerSec: 20,
  peakFailedPerSec: 0,
  peakIngestedPerSec: 20,
  redisMemoryUsedBytes: 0,
  redisMemoryPeakBytes: 0,
  redisMemoryMaxBytes: 0,
  redisConnectedClients: 0,
  redisEngineCpuPercent: null,
  processCpuPercent: 0,
  processMemoryUsedMb: 0,
  processMemoryTotalMb: 0,
  throughputHistory: [],
  pipelineTree: [],
  queues: [],
  latencyP50Ms: 327,
  latencyP99Ms: 1_648,
  peakLatencyP50Ms: 327,
  peakLatencyP99Ms: 1_648,
  latencyWindows: null,
  phases: {
    commands: emptyPhase(),
    projections: emptyPhase(),
    reactions: emptyPhase(),
  },
  jobNameMetrics: [],
  pausedKeys: [],
  topErrors: [],
  parkedTenants: [],
  parkedTenantsBound: { included: 0, total: 0 },
  errorClustersBound: { included: 0, total: 0 },
  snapshot: {
    computedAt: 1_755_100_000_000,
    detailComputedAt: 1_755_100_000_000,
    writerId: "writer-1",
    leaseEpoch: 1,
  },
  ...overrides,
});

const renderStrip = (overrides: Partial<DashboardData> = {}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <StatStrip data={makeData(overrides)} />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("StatStrip", () => {
  describe("given the dashboard shows P50 and P99 processing-time tiles", () => {
    describe("when the tiles render", () => {
      /** @scenario "The latency tiles state their sample basis" */
      it("states the completed-jobs sample basis, and that it is not a time window", () => {
        renderStrip();
        const strip = screen.getByTestId("ops-stat-strip");
        // The visible sublabel names the sample.
        expect(strip.textContent).toMatch(/last \d+ jobs/);
        // The hover hint spells the trap out, once per latency tile.
        expect(screen.getAllByTitle(/not a time window/)).toHaveLength(2);
      });

      it("shows the current percentile values", () => {
        renderStrip();
        const strip = screen.getByTestId("ops-stat-strip");
        expect(strip.textContent).toContain("P50");
        expect(strip.textContent).toContain("P99");
        expect(strip.textContent).toContain("327ms");
        expect(strip.textContent).toContain("1.6s");
      });
    });
  });

  describe("given dead letters exist on both substrates", () => {
    /** @scenario The dashboard's dead-letter figure covers both substrates */
    it("headlines the union and states how many come from each", () => {
      renderStrip({
        queues: [
          {
            name: "queue-a",
            displayName: "Queue A",
            pendingGroupCount: 0,
            blockedGroupCount: 0,
            activeGroupCount: 0,
            totalPendingJobs: 0,
            dlqCount: 6,
            parkedGroupCount: 0,
          },
        ],
      });
      const strip = screen.getByTestId("ops-stat-strip");
      expect(strip.textContent).toContain("Dead letters");
      expect(strip.textContent).toContain("100");
      expect(strip.textContent).toContain("6 queue · 94 outbox");
    });

    it("says the figure is unknown until the outbox count arrives", () => {
      // Half the union is not the union: rendering the queue figure alone
      // would state a wrong total, then jump and redden when the rest lands.
      outboxDeadQuery.mockReturnValueOnce({ data: undefined });
      renderStrip({
        queues: [
          {
            name: "queue-a",
            displayName: "Queue A",
            pendingGroupCount: 0,
            blockedGroupCount: 0,
            activeGroupCount: 0,
            totalPendingJobs: 0,
            dlqCount: 6,
            parkedGroupCount: 0,
          },
        ],
      });
      const strip = screen.getByTestId("ops-stat-strip");
      expect(strip.textContent).toContain("counting");
      expect(strip.textContent).not.toContain("6 queue");
    });
  });
});
