/**
 * Integration tests for trace-ID prefix resolution.
 *
 * The CLI `trace search` table truncates trace IDs to 20 characters for
 * readability. Copy-pasting that truncated ID into `trace get` used to hit
 * a 404 because the backend required exact matches. This exercises the
 * git-style prefix lookup that unblocks that workflow.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";

const tenantId = `test-trace-prefix-${nanoid()}`;
const otherTenantId = `test-trace-prefix-other-${nanoid()}`;
const now = Date.now();

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

async function insertTraceSummary(
  ch: ClickHouseClient,
  row: ReturnType<typeof makeTraceSummaryRow>,
) {
  await ch.insert({
    table: "trace_summaries",
    values: [row],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const occurredAtRange = {
  from: now - 60_000,
  to: now + 60_000,
};

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
  const getClickHouseClientForProject = vi.mocked(
    chModule.getClickHouseClientForProject,
  );
  getClickHouseClientForProject.mockResolvedValue(ch);

  const { prisma } = await import("~/server/db");
  service = new ClickHouseTraceService(
    prisma as ConstructorParameters<typeof ClickHouseTraceService>[0],
  );
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

describe("ClickHouseTraceService.resolveTraceIdByPrefix (integration)", () => {
  describe("when exactly one trace matches the prefix within the project", () => {
    const fullId = "63dc535cea6335c506bc81ef3543a07d";

    beforeAll(async () => {
      await insertTraceSummary(ch, makeTraceSummaryRow({ TraceId: fullId }));
    });

    it("returns the single full trace ID", async () => {
      const result = await service.resolveTraceIdByPrefix({
        projectId: tenantId,
        prefix: fullId.slice(0, 20),
        occurredAt: occurredAtRange,
      });

      expect(result).toEqual([fullId]);
    });

    it("still resolves when the caller passes the full ID", async () => {
      const result = await service.resolveTraceIdByPrefix({
        projectId: tenantId,
        prefix: fullId,
        occurredAt: occurredAtRange,
      });

      expect(result).toEqual([fullId]);
    });
  });

  describe("when the prefix matches multiple traces in the project", () => {
    const traceA = "abc123de00000000000000000000aaaa";
    const traceB = "abc123de00000000000000000000bbbb";

    beforeAll(async () => {
      await insertTraceSummary(ch, makeTraceSummaryRow({ TraceId: traceA }));
      await insertTraceSummary(ch, makeTraceSummaryRow({ TraceId: traceB }));
    });

    it("returns multiple IDs up to the limit so callers can detect ambiguity", async () => {
      const result = await service.resolveTraceIdByPrefix({
        projectId: tenantId,
        prefix: "abc123de",
        occurredAt: occurredAtRange,
        limit: 2,
      });

      expect(result).not.toBeNull();
      expect(result!).toHaveLength(2);
      expect(result!.sort()).toEqual([traceA, traceB].sort());
    });
  });

  describe("when no trace matches", () => {
    it("returns an empty array", async () => {
      const result = await service.resolveTraceIdByPrefix({
        projectId: tenantId,
        prefix: "deadbeefno-match",
        occurredAt: occurredAtRange,
      });

      expect(result).toEqual([]);
    });
  });

  describe("when the trace falls outside the OccurredAt window", () => {
    const outOfWindowTraceId = "fedcba9876543210fedcba9876543210";

    beforeAll(async () => {
      // Insert with OccurredAt far in the past — outside the test's window.
      await insertTraceSummary(
        ch,
        makeTraceSummaryRow({
          TraceId: outOfWindowTraceId,
          OccurredAt: new Date(now - 1_000_000),
        }),
      );
    });

    it("does not return traces outside the partition window", async () => {
      const result = await service.resolveTraceIdByPrefix({
        projectId: tenantId,
        prefix: outOfWindowTraceId.slice(0, 16),
        occurredAt: occurredAtRange,
      });

      expect(result).toEqual([]);
    });
  });

  describe("when another project has a matching trace ID", () => {
    const otherTraceId = "ffee112233445566778899aabbccddee";

    beforeAll(async () => {
      // Insert under a DIFFERENT tenant — MUST NOT leak across projects.
      await insertTraceSummary(
        ch,
        makeTraceSummaryRow({
          TraceId: otherTraceId,
          TenantId: otherTenantId,
        }),
      );
    });

    it("does not return it for a different project", async () => {
      const result = await service.resolveTraceIdByPrefix({
        projectId: tenantId,
        prefix: otherTraceId.slice(0, 20),
        occurredAt: occurredAtRange,
      });

      expect(result).toEqual([]);
    });
  });
});
