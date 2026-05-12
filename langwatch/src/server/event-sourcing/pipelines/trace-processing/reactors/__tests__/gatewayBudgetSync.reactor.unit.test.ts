import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBudget } from "@prisma/client";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createGatewayBudgetSyncReactor,
  type GatewayBudgetSyncReactorDeps,
} from "../gatewayBudgetSync.reactor";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

function createFoldState(
  attributes: Record<string, string> = {},
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 250,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hi",
    computedOutput: "bye",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["gpt-5-mini"],
    totalCost: 0.0042,
    tokensEstimated: false,
    totalPromptTokenCount: 120,
    totalCompletionTokenCount: 42,
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
    occurredAt: 1700_000_000_000,
    createdAt: 1700_000_000_000,
    updatedAt: 1700_000_000_000,
    attributes,
    ...overrides,
  };
}

const event: TraceProcessingEvent = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: "project-1",
  createdAt: Date.now(),
  occurredAt: Date.now(),
  type: "lw.obs.trace.span_received",
  version: 1,
  data: {
    span: {} as any,
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "STRICT",
  },
  metadata: { spanId: "span-1", traceId: "trace-1" },
} as unknown as TraceProcessingEvent;

function mockDeps(
  vk: { id: string; projectId: string; principalUserId: string | null } | null,
  project:
    | { id: string; teamId: string; team: { organizationId: string } }
    | null,
  budgets: GatewayBudget[] = [],
): {
  deps: GatewayBudgetSyncReactorDeps;
  insertDebit: ReturnType<typeof vi.fn>;
} {
  const insertDebit = vi.fn().mockResolvedValue(undefined);
  return {
    deps: {
      prisma: {
        virtualKey: {
          findUnique: vi.fn().mockResolvedValue(vk),
        },
        project: {
          findUnique: vi.fn().mockResolvedValue(project),
        },
      } as any,
      budgetRepository: {
        applicableForRequest: vi.fn().mockResolvedValue(budgets),
      } as any,
      budgetCHRepository: {
        insertDebit,
      } as any,
    },
    insertDebit,
  };
}

function ctx(foldState: TraceSummaryData): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "project-1",
    aggregateId: "trace-1",
    foldState,
  };
}

describe("gatewayBudgetSync reactor", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the trace lacks gateway attributes", () => {
    it("short-circuits without reading PG or writing CH", async () => {
      const { deps, insertDebit } = mockDeps(null, null, []);
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(event, ctx(createFoldState({})));

      expect(insertDebit).not.toHaveBeenCalled();
      expect(deps.prisma.virtualKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("when the VK is unknown", () => {
    it("logs + skips without writing to CH", async () => {
      const { deps, insertDebit } = mockDeps(null, null, []);
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-missing",
            "langwatch.gateway_request_id": "req-1",
          }),
        ),
      );

      expect(insertDebit).not.toHaveBeenCalled();
    });
  });

  describe("when the VK belongs to a different project", () => {
    it("logs + skips without writing to CH", async () => {
      const { deps, insertDebit } = mockDeps(
        { id: "vk-1", projectId: "project-other", principalUserId: null },
        null,
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-1",
          }),
        ),
      );

      expect(insertDebit).not.toHaveBeenCalled();
    });
  });

  describe("when the VK has no applicable budgets", () => {
    it("skips the CH write — no rows to fold", async () => {
      const { deps, insertDebit } = mockDeps(
        { id: "vk-1", projectId: "project-1", principalUserId: null },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
        [],
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-1",
          }),
        ),
      );

      expect(insertDebit).not.toHaveBeenCalled();
    });
  });

  describe("when the VK has a project-scoped budget", () => {
    it("writes one BudgetDebitRow with cost + tokens from the fold state", async () => {
      const budget = {
        id: "budget-1",
        scopeType: "PROJECT",
        scopeId: "project-1",
        window: "MONTH",
      } as GatewayBudget;

      const { deps, insertDebit } = mockDeps(
        { id: "vk-1", projectId: "project-1", principalUserId: null },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
        [budget],
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-1",
          }),
        ),
      );

      expect(insertDebit).toHaveBeenCalledTimes(1);
      const rows = insertDebit.mock.calls[0]![0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId: "project-1",
        budgetId: "budget-1",
        scope: "PROJECT",
        scopeId: "project-1",
        window: "MONTH",
        virtualKeyId: "vk-1",
        gatewayRequestId: "req-1",
        amountUsd: "0.0042000000",
        tokensInput: 120,
        tokensOutput: 42,
        model: "gpt-5-mini",
        status: "SUCCESS",
      });
    });
  });

  describe("when the trace was blocked by a guardrail", () => {
    it("emits BLOCKED_BY_GUARDRAIL status with zero cost", async () => {
      const budget = {
        id: "budget-1",
        scopeType: "PROJECT",
        scopeId: "project-1",
        window: "MONTH",
      } as GatewayBudget;

      const { deps, insertDebit } = mockDeps(
        { id: "vk-1", projectId: "project-1", principalUserId: null },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
        [budget],
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState(
            {
              "langwatch.virtual_key_id": "vk-1",
              "langwatch.gateway_request_id": "req-2",
            },
            { blockedByGuardrail: true, totalCost: 0 },
          ),
        ),
      );

      expect(insertDebit).toHaveBeenCalledTimes(1);
      expect(insertDebit.mock.calls[0]![0][0]).toMatchObject({
        status: "BLOCKED_BY_GUARDRAIL",
        amountUsd: "0.0000000000",
      });
    });
  });
});
