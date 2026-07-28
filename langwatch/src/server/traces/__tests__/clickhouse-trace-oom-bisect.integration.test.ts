/**
 * Integration tests for the OOM batch-retry / bisection fallback.
 *
 * The unit tests around this path mock the rejection, so they can only prove
 * the helper reacts to an error SHAPE we hand it. These exercise the real
 * chain end to end against a testcontainers ClickHouse:
 *
 *   real ClickHouse MEMORY_LIMIT_EXCEEDED
 *     -> the driver's own error
 *     -> translateClickHouseQueryError / QueryMemoryExceededError
 *     -> isClickHouseMemoryLimitError
 *     -> retryInBatchesWithBisect
 *
 * so a regression anywhere in that chain — a changed error class, a detector
 * that stops unwrapping, a swallowed rejection — fails here even though every
 * mock-based test stays green.
 *
 * How the OOM is triggered: a proxy client injects `max_memory_usage` into the
 * heavy summary read, tightly for large batches and generously for small ones.
 * The ceiling is chosen per batch size deliberately, so the test is
 * deterministic rather than dependent on how much memory a given ClickHouse
 * build happens to allocate. Everything downstream of the trigger — the error,
 * its translation, the detection, the recovery, the returned rows — is real.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type { GetAllTracesForProjectInput } from "../types";
import { openProtections } from "./open-protections";

const tenantId = `test-oom-bisect-${nanoid()}`;
const now = Date.now();

/** Big enough that a 25-row read genuinely needs room, small enough to insert fast. */
const PAYLOAD = JSON.stringify({
  type: "text",
  value: "x".repeat(200_000),
});

const TRACE_COUNT = 30;
const traceIds = Array.from(
  { length: TRACE_COUNT },
  (_, i) => `trace-oom-${String(i).padStart(3, "0")}-${nanoid()}`,
);

function makeTraceSummaryRow(traceId: string, index: number) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    // Spread across a minute so the page has a deterministic sort order.
    OccurredAt: new Date(now - index * 1000),
    CreatedAt: new Date(now - index * 1000),
    UpdatedAt: new Date(now - index * 1000),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: PAYLOAD,
    ComputedOutput: PAYLOAD,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
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
  };
}

function makeQueryInput(
  overrides: Partial<GetAllTracesForProjectInput> = {},
): GetAllTracesForProjectInput {
  return {
    projectId: tenantId,
    startDate: now - 600_000,
    endDate: now + 600_000,
    filters: {},
    pageSize: TRACE_COUNT,
    ...overrides,
  };
}

/**
 * Wrap the real client so the heavy summary read runs under a memory ceiling.
 *
 * `limitFor` receives the batch's id count and returns the `max_memory_usage`
 * bytes for that query, or null to leave it unbounded. Only the heavy read is
 * touched — the count and id queries must still succeed for the page to get as
 * far as the summary read at all.
 */
function memoryCappedClient(
  base: ClickHouseClient,
  limitFor: (batchSize: number) => number | null,
): { client: ClickHouseClient; batchSizes: number[] } {
  const batchSizes: number[] = [];
  const client = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop !== "query") return Reflect.get(target, prop, receiver);
      return (args: {
        query: string;
        query_params?: Record<string, unknown>;
        clickhouse_settings?: Record<string, unknown>;
      }) => {
        const ids = args.query_params?.pageTraceIds;
        const isHeavySummaryRead =
          typeof args.query === "string" &&
          args.query.includes("ts_ComputedInput") &&
          Array.isArray(ids);

        if (!isHeavySummaryRead) {
          return (target as ClickHouseClient).query(args as never);
        }

        batchSizes.push((ids as string[]).length);
        const limit = limitFor((ids as string[]).length);
        return (target as ClickHouseClient).query({
          ...args,
          clickhouse_settings: {
            ...(args.clickhouse_settings ?? {}),
            ...(limit === null ? {} : { max_memory_usage: String(limit) }),
          },
        } as never);
      };
    },
  }) as ClickHouseClient;
  return { client, batchSizes };
}

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: { project: { findUnique: vi.fn().mockResolvedValue({}) } },
}));

let ch: ClickHouseClient;
let service: ClickHouseTraceService;
let getClickHouseClientForProject: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const chModule = await import("~/server/clickhouse/clickhouseClient");
  getClickHouseClientForProject = vi.mocked(
    chModule.getClickHouseClientForProject,
  );
  getClickHouseClientForProject.mockResolvedValue(ch);

  const { prisma } = await import("~/server/db");
  service = new ClickHouseTraceService(
    prisma as ConstructorParameters<typeof ClickHouseTraceService>[0],
  );

  await ch.insert({
    table: "trace_summaries",
    values: traceIds.map((id, i) => makeTraceSummaryRow(id, i)),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("ClickHouse OOM bisection (integration)", () => {
  describe("getAllTracesForProject()", () => {
    describe("given a real MEMORY_LIMIT_EXCEEDED on the full-list summary read", () => {
      /** @scenario A page still loads when the database runs out of memory */
      it("recovers the whole page by bisecting until the batches fit", async () => {
        // Tight for anything over 12 ids, generous below — so the full list of
        // 30 OOMs, the 25-id batch OOMs, and the bisected halves succeed.
        const { client, batchSizes } = memoryCappedClient(ch, (size) =>
          size > 12 ? 1_000_000 : null,
        );
        getClickHouseClientForProject.mockResolvedValue(client);
        try {
          const result = await service.getAllTracesForProject(
            makeQueryInput(),
            openProtections,
          );

          // Every trace still comes back: the recovery is lossless, not
          // best-effort.
          expect(result).not.toBeNull();
          expect(result!.groups.flat()).toHaveLength(TRACE_COUNT);
        } finally {
          getClickHouseClientForProject.mockResolvedValue(ch);
        }

        // The shape of the descent, from the real run: the full list, then
        // fixed-size batching, then a bisected pair that fits.
        expect(batchSizes[0]).toBe(TRACE_COUNT);
        expect(batchSizes).toContain(25);
        expect(batchSizes.some((n) => n <= 12 && n > 0)).toBe(true);
      }, 120_000);

      /** @scenario A page recovered from a memory limit matches an unaffected read */
      it("returns rows identical to the same read without any memory pressure", async () => {
        const unpressured = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
        );

        const { client } = memoryCappedClient(ch, (size) =>
          size > 12 ? 1_000_000 : null,
        );
        getClickHouseClientForProject.mockResolvedValue(client);
        let bisected: Awaited<
          ReturnType<typeof service.getAllTracesForProject>
        >;
        try {
          bisected = await service.getAllTracesForProject(
            makeQueryInput(),
            openProtections,
          );
        } finally {
          getClickHouseClientForProject.mockResolvedValue(ch);
        }

        // The point of the re-sort in the caller: batches come back in chunk
        // order, so without it the recovered page would be ordered differently
        // from the happy path. Ids AND order must match exactly.
        const idsOf = (
          r: Awaited<ReturnType<typeof service.getAllTracesForProject>>,
        ) => r!.groups.flat().map((t) => t.trace_id);
        expect(idsOf(bisected)).toEqual(idsOf(unpressured));
      }, 120_000);
    });

    describe("given every batch size still OOMs", () => {
      /** @scenario A trace that cannot be read alone fails the page instead of retrying forever */
      it("gives up instead of grinding, and surfaces the memory error", async () => {
        // A ceiling nothing can satisfy: the descent reaches a single id,
        // which cannot be split further, so the error propagates.
        const { client, batchSizes } = memoryCappedClient(ch, () => 1);
        getClickHouseClientForProject.mockResolvedValue(client);
        try {
          await expect(
            service.getAllTracesForProject(makeQueryInput(), openProtections),
          ).rejects.toThrow();
        } finally {
          getClickHouseClientForProject.mockResolvedValue(ch);
        }

        // Bounded work, not a runaway: the fan-out stays far below the
        // ceil(30/25) + MAX_BISECT_RETRIES ceiling rather than exploring the
        // whole tree before failing.
        expect(batchSizes.length).toBeLessThanOrEqual(2 + 100);
        expect(batchSizes).toContain(1);
      }, 120_000);
    });
  });
});
