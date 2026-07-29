// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import {
  GATEWAY_SPANS_ATTR,
  type GatewaySpanEntry,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/gateway-spans.service";
import type { ReactorContext } from "~/server/event-sourcing/reactors/reactor.types";
import {
  createBillingExportReactor,
  type BillingExportReactorDeps,
} from "../billingExport.reactor";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

function entry(
  requestId: string,
  overrides: Partial<GatewaySpanEntry> = {},
): GatewaySpanEntry {
  return {
    requestId,
    virtualKeyId: "vk-1",
    model: "openai/gpt-5-mini",
    modelProviderId: "",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.0042,
    status: "success",
    errorClass: "",
    httpStatus: 0,
    endUserId: "",
    metadata: "",
    occurredAtMs: 1_700_000_000_000,
    durationMs: 250,
    ...overrides,
  };
}

function createFoldState(
  attributes: Record<string, string> = {},
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 250,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["openai/gpt-5-mini"],
    totalCost: 0.0042,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: 100,
    totalCompletionTokenCount: 20,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    traceName: "",
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    LastEventOccurredAt: 0,
    occurredAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    attributes,
    ...overrides,
  };
}

const event = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: "project-1",
  type: "lw.obs.trace.span_received",
} as unknown as TraceProcessingEvent;

function ctx(foldState: TraceSummaryData): ReactorContext<TraceSummaryData> {
  return { tenantId: "project-1", aggregateId: "trace-1", foldState };
}

function mockDeps({
  vks = [{ id: "vk-1", organizationId: "org-1", principalUserId: null }],
  project = {
    id: "project-1",
    teamId: "team-1",
    team: { organizationId: "org-1" },
  },
}: {
  vks?: Array<{
    id: string;
    organizationId: string;
    principalUserId: string | null;
  }>;
  project?: {
    id: string;
    teamId: string;
    team: { organizationId: string };
  } | null;
} = {}): {
  deps: BillingExportReactorDeps;
  insertSpendEvents: ReturnType<typeof vi.fn>;
} {
  const insertSpendEvents = vi.fn().mockResolvedValue(1);
  return {
    deps: {
      prisma: {
        virtualKey: { findMany: vi.fn().mockResolvedValue(vks) },
        project: { findUnique: vi.fn().mockResolvedValue(project) },
      } as any,
      spendEventsRepository: { insertSpendEvents } as any,
    },
    insertSpendEvents,
  };
}

function gatewayAttrs(entries: GatewaySpanEntry[]): Record<string, string> {
  return {
    "langwatch.virtual_key_id": entries[0]?.virtualKeyId ?? "vk-1",
    "langwatch.gateway_request_id": entries[0]?.requestId ?? "req-1",
    [GATEWAY_SPANS_ATTR]: JSON.stringify(entries),
  };
}

describe("billingExport reactor", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the trace is not gateway traffic", () => {
    it("short-circuits without reading PG or writing CH", async () => {
      const { deps, insertSpendEvents } = mockDeps();
      const reactor = createBillingExportReactor(deps);

      await reactor.handle(event, ctx(createFoldState({})));

      expect(insertSpendEvents).not.toHaveBeenCalled();
      expect(deps.prisma.virtualKey.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when the key has no budgets at all", () => {
    /** @scenario A gateway request is metered even when its key has no budget */
    it("still writes the spend record, no budget machinery involved", async () => {
      const { deps, insertSpendEvents } = mockDeps();
      const reactor = createBillingExportReactor(deps);

      await reactor.handle(
        event,
        ctx(createFoldState(gatewayAttrs([entry("req-1")]))),
      );

      expect(insertSpendEvents).toHaveBeenCalledTimes(1);
      const rows = insertSpendEvents.mock.calls[0]![0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId: "project-1",
        gatewayRequestId: "req-1",
        organizationId: "org-1",
        teamId: "team-1",
        virtualKeyId: "vk-1",
        costUsd: "0.004200",
        status: "success",
      });
    });
  });

  describe("per-request grain", () => {
    /** @scenario Budget debits stay budget-gated while spend records never are */
    it("writes one row per entry with per-entry values", async () => {
      const { deps, insertSpendEvents } = mockDeps();
      const reactor = createBillingExportReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState(
            gatewayAttrs([
              entry("req-1", { costUsd: 0.001, cacheReadTokens: 20540 }),
              entry("req-2", {
                costUsd: 0.002,
                status: "error",
                errorClass: "provider_timeout",
                httpStatus: 504,
              }),
            ]),
          ),
        ),
      );

      const rows = insertSpendEvents.mock.calls[0]![0];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        gatewayRequestId: "req-1",
        costUsd: "0.001000",
        tokensCacheRead: 20540,
      });
      expect(rows[1]).toMatchObject({
        gatewayRequestId: "req-2",
        costUsd: "0.002000",
        status: "error",
        errorClass: "provider_timeout",
        httpStatus: 504,
      });
      // Request time, never ingest time.
      expect(rows[0].occurredAt.getTime()).toBe(1_700_000_000_000);
    });

    /** @scenario The end user id and metadata echo ride the entry into billing */
    it("carries the entry's end user id and metadata echo into the row", async () => {
      const { deps, insertSpendEvents } = mockDeps();
      const reactor = createBillingExportReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState(
            gatewayAttrs([
              entry("req-1", {
                endUserId: "acme-user-42",
                metadata: '{"org_id":"acme-9"}',
              }),
            ]),
          ),
        ),
      );

      const rows = insertSpendEvents.mock.calls[0]![0];
      expect(rows[0]).toMatchObject({
        endUserId: "acme-user-42",
        metadata: '{"org_id":"acme-9"}',
      });
    });
  });

  describe("legacy fold state without entries", () => {
    /** @scenario Entry-less legacy folds still meter as one whole-trace record */
    it("writes one whole-trace row under the first request id", async () => {
      const { deps, insertSpendEvents } = mockDeps();
      const reactor = createBillingExportReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-legacy",
          }),
        ),
      );

      const rows = insertSpendEvents.mock.calls[0]![0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        gatewayRequestId: "req-legacy",
        tokensInput: 100,
        tokensOutput: 20,
        costUsd: "0.004200",
      });
    });
  });

  describe("attribution guards", () => {
    it("skips rows for unknown or cross-tenant keys", async () => {
      const { deps, insertSpendEvents } = mockDeps({
        vks: [
          { id: "vk-other", organizationId: "org-2", principalUserId: null },
        ],
      });
      const reactor = createBillingExportReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState(
            gatewayAttrs([
              entry("req-1", { virtualKeyId: "vk-unknown" }),
              entry("req-2", { virtualKeyId: "vk-other" }),
            ]),
          ),
        ),
      );

      expect(insertSpendEvents).not.toHaveBeenCalled();
    });

    it("carries VK labels from the fold into every row", async () => {
      const { deps, insertSpendEvents } = mockDeps();
      const reactor = createBillingExportReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            ...gatewayAttrs([entry("req-1")]),
            "langwatch.labels": JSON.stringify(["customer:acme-172"]),
          }),
        ),
      );

      expect(insertSpendEvents.mock.calls[0]![0][0].labels).toEqual([
        "customer:acme-172",
      ]);
    });
  });

  describe("failure semantics", () => {
    it("rethrows on insert failure so at-least-once retry gets another shot", async () => {
      const { deps, insertSpendEvents } = mockDeps();
      insertSpendEvents.mockRejectedValue(new Error("ch down"));
      const reactor = createBillingExportReactor(deps);

      await expect(
        reactor.handle(
          event,
          ctx(createFoldState(gatewayAttrs([entry("req-1")]))),
        ),
      ).rejects.toThrow("ch down");
    });
  });
});
