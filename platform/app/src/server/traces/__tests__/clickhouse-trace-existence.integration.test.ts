/**
 * Which of a set of candidate trace IDs a project actually holds.
 *
 * The write paths that store a reference to a trace (queueing one for
 * annotation, above all) ask this before they write, so a reference to a trace
 * that never existed is never stored. See specs/traces-v2/bulk-actions.feature.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";

const tenantId = `test-trace-exists-${nanoid()}`;
const otherTenantId = `test-trace-exists-other-${nanoid()}`;
const now = Date.now();

const liveTraceId = `live-${nanoid()}`;
const otherTenantTraceId = `other-tenant-${nanoid()}`;

function makeTraceSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: `trace-${nanoid()}`,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 0,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
    ...overrides,
  };
}

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn().mockResolvedValue({}),
    },
  },
}));

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const chModule = await import("~/server/clickhouse/clickhouseClient");
  vi.mocked(chModule.getClickHouseClientForProject).mockResolvedValue(ch);

  const { prisma } = await import("~/server/db");
  service = new ClickHouseTraceService({
    prisma: prisma as ConstructorParameters<typeof ClickHouseTraceService>[0]["prisma"],
  });

  await ch.insert({
    table: "trace_summaries",
    values: [
      makeTraceSummaryRow({ TraceId: liveTraceId }),
      // A second version of the same trace: existence is set membership, so an
      // unmerged duplicate must not turn one trace into two answers.
      makeTraceSummaryRow({
        TraceId: liveTraceId,
        UpdatedAt: new Date(now + 1),
      }),
      makeTraceSummaryRow({
        TenantId: otherTenantId,
        TraceId: otherTenantTraceId,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE trace_summaries DELETE WHERE TenantId IN ({a:String}, {b:String})`,
      query_params: { a: tenantId, b: otherTenantId },
    });
  }
  await stopTestContainers();
});

describe("ClickHouseTraceService.findExistingTraceIds (integration)", () => {
  describe("when some of the candidates exist", () => {
    /** @scenario "Sending traces for annotation skips ids that resolve to no trace" */
    it("returns the ones the project holds, once each", async () => {
      const result = await service.findExistingTraceIds({
        projectId: tenantId,
        traceIds: [liveTraceId, `missing-${nanoid()}`],
      });

      expect(result).toEqual([liveTraceId]);
    });
  });

  describe("when the candidate belongs to another project", () => {
    /** @scenario "Sending traces for annotation skips ids that resolve to no trace" */
    it("does not report it as existing", async () => {
      const result = await service.findExistingTraceIds({
        projectId: tenantId,
        traceIds: [otherTenantTraceId],
      });

      expect(result).toEqual([]);
    });
  });

  describe("when there is nothing to check", () => {
    /** @scenario "Blank ids are dropped before anything is queued" */
    it("answers without asking ClickHouse", async () => {
      expect(
        await service.findExistingTraceIds({
          projectId: tenantId,
          traceIds: [],
        }),
      ).toEqual([]);
    });
  });
});
