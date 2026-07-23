/**
 * #5082 — a SUMMARY-mode export of an offloaded trace must carry the FULL value,
 * end-to-end, against a REAL ClickHouse.
 *
 * Why this file exists, and why the unit tests were not enough:
 *
 * The reviewer's P1 was "summary exports silently ship the truncated 64 KB
 * preview." The first fix set `resolveBlobs: true` at the call sites, and the
 * unit tests asserted that the option was FORWARDED to getAllTracesForProject.
 * They passed. The bug was untouched — resolution lived inside
 * enrichTracesWithSpans, which ran only `if (options.includeSpans)`, and summary
 * mode sets includeSpans=false, so the flag was never read. **A test that asserts
 * a flag is forwarded passes whether or not the flag does anything.**
 *
 * So this test asserts the VALUE, through the real stack:
 *
 *   real ClickHouse (trace_summaries + stored_spans + event_log)
 *     -> real ClickHouseTraceService  (the includeSpans/resolveBlobs gate)
 *     -> real resolveOffloadedTracesBatch + real BlobStore (the event_log read)
 *     -> real ExportService in SUMMARY mode
 *     -> real CSV / JSONL serializers
 *     -> assert the exported bytes contain UNIQUE_TAIL
 *
 * UNIQUE_TAIL sits past the 64 KB preview boundary by construction (the preview
 * is `value.slice(0, 64KB) + "…"`), so it exists ONLY in the de-offloaded value.
 * A preview-only export cannot contain it. That makes the assertion falsifiable
 * against the actual bug rather than against a mock's arguments.
 *
 * AC5 is guarded in the same file: the list/search read (no resolveBlobs) over
 * the SAME offloaded trace must still come back as the preview, with the tail
 * absent — proving the fix did not turn the heavy-read protection off.
 *
 * BDD structure: describe("given …") -> describe("when …") -> it("…").
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertOverThreshold,
  insertEventLogRow,
  LARGE_VALUE,
  UNIQUE_TAIL,
} from "~/server/app-layer/traces/__tests__/blob-offload-test-helpers";
import {
  EVENTREF_ATTR_PREFIX,
  IO_PREVIEW_BYTES,
} from "~/server/app-layer/traces/lean-for-projection";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { openProtections } from "~/server/traces/__tests__/open-protections";
import { ExportService } from "../export.service";
import type { ExportRequest } from "../types";

// Gate identically to the other blob-offload integration tests: skip when no
// real ClickHouse is reachable, run against the testcontainer otherwise.
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

const tenantId = `test-export-blob-${nanoid()}`;
const traceId = `trace-export-blob-${nanoid()}`;
const spanId = `span-export-blob-${nanoid()}`;
const eventId = `evt-export-blob-${nanoid()}`;
const now = Date.now();

/** The 64 KB preview the projection stores — the lossy thing we must NOT serve. */
const PREVIEW_VALUE = `${LARGE_VALUE.slice(0, IO_PREVIEW_BYTES)}…`;

/** The IO envelope shape trace_summaries/stored_spans store. */
const previewEnvelope = JSON.stringify({
  type: "text",
  value: PREVIEW_VALUE,
});

// Override ONLY the client resolver — the rest of the module (isClickHouseEnabled,
// used by buildTraceBlobResolutionDeps) must stay real, so the production wiring
// is what runs.
vi.mock("~/server/clickhouse/clickhouseClient", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/clickhouse/clickhouseClient")
    >();
  return { ...actual, getClickHouseClientForProject: vi.fn() };
});

vi.mock("~/server/db", () => ({
  prisma: { project: { findUnique: vi.fn().mockResolvedValue({}) } },
}));

let ch: ClickHouseClient;

/**
 * Writes the trace exactly as an offloaded ingest leaves it:
 *   - event_log      : the FULL >64 KB value (the only place it exists)
 *   - stored_spans   : the 64 KB preview + the reserved eventref pointer
 *   - trace_summaries: the 64 KB preview in ComputedOutput
 */
async function seedOffloadedTrace() {
  await insertEventLogRow({
    client: ch,
    tenantId,
    aggregateId: traceId, // ADR-022: aggregateId for trace-processing IS the traceId
    eventId,
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    eventVersion: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    eventData: {
      span: {
        traceId,
        spanId,
        attributes: [
          { key: "langwatch.output", value: { stringValue: LARGE_VALUE } },
        ],
      },
    },
  });

  await ch.insert({
    table: "stored_spans",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        SpanId: spanId,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: new Date(now),
        EndTime: new Date(now + 100),
        DurationMs: 100,
        SpanName: "test-span",
        SpanKind: 1,
        ServiceName: "test-service",
        ResourceAttributes: {},
        SpanAttributes: {
          // The leaned preview, plus the reserved eventref the resolver follows
          // back to event_log. This is the shape leanForProjection emits.
          "langwatch.output": PREVIEW_VALUE,
          [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
            eventId,
            field: "langwatch.output",
          }),
        },
        StatusCode: 1,
        StatusMessage: null,
        ScopeName: "test",
        ScopeVersion: null,
        "Events.Timestamp": [],
        "Events.Name": [],
        "Events.Attributes": [],
        "Links.TraceId": [],
        "Links.SpanId": [],
        "Links.Attributes": [],
        DroppedAttributesCount: 0,
        DroppedEventsCount: 0,
        DroppedLinksCount: 0,
        CreatedAt: new Date(now),
        UpdatedAt: new Date(now),
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });

  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        Attributes: {},
        OccurredAt: new Date(now),
        CreatedAt: new Date(now),
        UpdatedAt: new Date(now),
        ComputedIOSchemaVersion: "v1",
        ComputedInput: null,
        ComputedOutput: previewEnvelope,
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
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** Drains the real ExportService and returns the concatenated payload. */
async function runExport(request: ExportRequest): Promise<string> {
  // create() resolves prisma + the blob-resolution deps itself; the CH client it
  // ends up using is the testcontainer, via the mocked resolver above.
  const service = await ExportService.create();
  let payload = "";
  for await (const { chunk } of service.exportTraces({
    request,
    protections: openProtections,
  })) {
    payload += chunk;
  }
  return payload;
}

function buildRequest(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    projectId: tenantId,
    mode: "summary",
    format: "csv",
    filters: {},
    startDate: now - 60_000,
    endDate: now + 60_000,
    ...overrides,
  } as ExportRequest;
}

beforeAll(async () => {
  if (!hasTestcontainers) return;

  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const chModule = await import("~/server/clickhouse/clickhouseClient");
  vi.mocked(chModule.getClickHouseClientForProject).mockResolvedValue(ch);

  assertOverThreshold(LARGE_VALUE);
  await seedOffloadedTrace();
}, 120_000);

afterAll(async () => {
  if (ch) {
    for (const table of ["trace_summaries", "stored_spans", "event_log"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await stopTestContainers();
});

describe.skipIf(!hasTestcontainers)(
  "#5082 — summary-mode export of an offloaded trace (real ClickHouse)",
  () => {
    describe("given a trace whose output was offloaded to event_log (>64 KB)", () => {
      describe("when it is exported in SUMMARY mode (no spans emitted)", () => {
        it("writes the FULL de-offloaded value into the CSV, not the 64 KB preview", async () => {
          const csv = await runExport(buildRequest({ format: "csv" }));

          // The tail exists ONLY past the preview boundary, so its presence is
          // proof the event_log value was resolved and served.
          expect(csv).toContain(UNIQUE_TAIL);
        });

        it("does not truncate at the preview boundary", async () => {
          const csv = await runExport(buildRequest({ format: "csv" }));

          // The lossy preview ends in the ellipsis the leaner appends; the
          // resolved value does not.
          expect(csv).not.toContain(`${"x".repeat(64)}…`);
          expect(csv.length).toBeGreaterThan(IO_PREVIEW_BYTES);
        });

        it("writes the FULL value in JSON (JSONL) summary mode too", async () => {
          const jsonl = await runExport(buildRequest({ format: "json" }));

          expect(jsonl).toContain(UNIQUE_TAIL);
        });
      });
    });

    // AC5 — the fix must not have disarmed the heavy-read protection. The list
    // grid reads the SAME offloaded trace and must still get the preview.
    describe("given the SAME offloaded trace read by the list/search grid", () => {
      describe("when it is read WITHOUT resolveBlobs", () => {
        it("keeps the 64 KB preview and never de-offloads", async () => {
          const { ClickHouseTraceService } = await import(
            "~/server/traces/clickhouse-trace.service"
          );
          const { prisma } = await import("~/server/db");

          // No resolvers wired at all — the list-grid construction shape.
          const listService = new ClickHouseTraceService(
            prisma as ConstructorParameters<typeof ClickHouseTraceService>[0],
          );

          const result = await listService.getAllTracesForProject(
            {
              projectId: tenantId,
              startDate: now - 60_000,
              endDate: now + 60_000,
              filters: {},
              pageSize: 100,
            } as never,
            openProtections,
            { includeSpans: true }, // spans, but NO resolveBlobs
          );

          const trace = result?.groups.flat()[0];
          expect(trace?.output?.value).not.toContain(UNIQUE_TAIL);
          expect(trace?.output?.value).toContain("…");
        });
      });
    });
  },
);
