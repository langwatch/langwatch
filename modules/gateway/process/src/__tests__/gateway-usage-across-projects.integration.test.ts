/**
 * The Usage page's reads in an organization with many projects, each trace read passing through
 * the real ClickHouse statement admission the process bounds its statements with.
 * @vitest-environment node
 * @see modules/gateway/specs/gateway-usage-read.feature
 */
import {
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseStatementAdmission,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import {
  ClickHouseOverloadedError,
  type TraceApi,
  type TraceAttributedTrace,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { GatewayUsageService } from "../features/spend/services/gateway-spend-summary.service.ts";

const ORGANIZATION_ID = "org_1";
const KEY_ID = "vk_demo";
const PROJECT_IDS = Array.from({ length: 400 }, (_, index) => `project_${index}`);
const OCCURRED_AT_MS = Temporal.Instant.from("2026-11-03T10:00:00Z").epochMilliseconds;
const WINDOW = {
  fromDate: Temporal.Instant.from("2026-11-01T00:00:00Z"),
  toDate: Temporal.Instant.from("2026-11-12T00:00:00Z"),
};

class QuietTelemetry extends ClickHouseManagedClientTelemetry {
  registerLimiter(): void {}
  unregisterLimiter(): void {}
  observeStatementWait(): void {}
  incrementStatementsShed(): void {}
}

class OverloadRefusal extends ClickHouseOverloadErrorFactory {
  create(): unknown {
    return new ClickHouseOverloadedError();
  }
}

/** The key's two traces, in two of the organization's 400 projects. */
const TRACES: { projectId: string; trace: TraceAttributedTrace }[] = [
  { projectId: "project_7", cost: "0.75" },
  { projectId: "project_391", cost: "0.50" },
].map(({ projectId, cost }, index) => ({
  projectId,
  trace: {
    traceId: `trace_${index}`,
    value: KEY_ID,
    costUsd: cost,
    models: ["gpt-5-mini"],
    occurredAtMs: OCCURRED_AT_MS + index,
    promptTokens: 0,
    completionTokens: 0,
    durationMs: 0,
    hasError: false,
    blockedByGuardrail: false,
  },
}));

/** Trace's reads, each one statement admitted (or refused) as the ClickHouse member does. */
function admittedTraces() {
  const admission = new ClickHouseStatementAdmission({
    instance: "routed",
    maxConcurrent: 8,
    telemetry: new QuietTelemetry(),
    overloadErrorFactory: new OverloadRefusal(),
  });
  const statement = <T>(rows: () => T[]) =>
    admission.run({
      operation: "query",
      task: () => new Promise<T[]>((resolve) => setTimeout(() => resolve(rows()), 5)),
    });
  const inProjects = (projectIds: readonly string[]) =>
    TRACES.filter(({ projectId }) => projectIds.includes(projectId)).map(({ trace }) => trace);

  const findAttributeUsageBuckets = vi.fn<TraceApi["findAttributeUsageBuckets"]>((input) =>
    statement(() =>
      inProjects(input.projectIds).map((trace) => ({
        value: trace.value,
        model: trace.models[0] ?? "unknown",
        day: "2026-11-03",
        totalUsd: trace.costUsd,
        requests: 1,
        blockedRequests: 0,
      })),
    ),
  );
  const findAttributedTraces = vi.fn<TraceApi["findAttributedTraces"]>((input) =>
    statement(() =>
      inProjects(input.projectIds)
        .toSorted((a, b) => b.occurredAtMs - a.occurredAtMs)
        .slice(0, input.limit),
    ),
  );
  return { findAttributeUsageBuckets, findAttributedTraces };
}

function usageService() {
  const traces = admittedTraces();
  const service = GatewayUsageService.create({
    projects: { listIdsByOrganization: async () => PROJECT_IDS },
    virtualKeys: {
      findMetaByIds: async () => [{ id: KEY_ID, name: "demo", displayPrefix: "lw_vk_demo" }],
    },
    chRepo: undefined,
    traces: createApiFixture<TraceApi>(traces),
  });
  return { service, traces };
}

describe("given an organization with 400 projects and the key's traces in two of them", () => {
  describe("when the Usage page reads this month's summary", () => {
    /** @scenario "The Usage page's summary is read in one statement however many projects the organization has" */
    it("answers the key's total from one trace read over every project", async () => {
      const { service, traces } = usageService();

      const summary = await service.summary({
        organizationId: ORGANIZATION_ID,
        virtualKeyIds: [KEY_ID],
        window: WINDOW,
      });

      expect(summary).toMatchObject({ totalUsd: "1.250000", totalRequests: 2 });
      expect(summary.byVirtualKey).toEqual([
        expect.objectContaining({ virtualKeyId: KEY_ID, totalUsd: "1.250000", requests: 2 }),
      ]);
      expect(traces.findAttributeUsageBuckets).toHaveBeenCalledOnce();
      expect(traces.findAttributeUsageBuckets).toHaveBeenCalledWith(
        expect.objectContaining({ projectIds: PROJECT_IDS }),
      );
    });
  });

  describe("when the Usage page reads one key's summary", () => {
    /** @scenario "One key's usage is read in two statements however many projects the organization has" */
    it("answers its total and recent requests from one read of each over every project", async () => {
      const { service, traces } = usageService();

      const summary = await service.summaryForVirtualKey({
        organizationId: ORGANIZATION_ID,
        virtualKeyId: KEY_ID,
        window: WINDOW,
      });

      expect(summary).toMatchObject({ totalUsd: "1.250000", totalRequests: 2 });
      expect(summary.recentDebits.map((debit) => debit.id)).toEqual(["trace_1", "trace_0"]);
      expect(traces.findAttributeUsageBuckets).toHaveBeenCalledOnce();
      expect(traces.findAttributedTraces).toHaveBeenCalledOnce();
    });
  });
});
