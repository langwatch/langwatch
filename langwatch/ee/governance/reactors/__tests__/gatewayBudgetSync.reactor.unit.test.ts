import type { GatewayBudget } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { ReactorContext } from "~/server/event-sourcing/reactors/reactor.types";
import {
  createGatewayBudgetSyncReactor,
  type GatewayBudgetSyncReactorDeps,
} from "../gatewayBudgetSync.reactor";

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
  toError: vi.fn((e) => e instanceof Error ? e : new Error(String(e))),
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
    nonBilledCost: null,
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

type ResolvedBudgetStub = {
  budget: GatewayBudget;
  bucketScopeId: string;
  principalUserId: string | null;
  groupId: string | null;
};

function mockDeps(
  vk:
    | { id: string; organizationId: string; principalUserId: string | null }
    | null,
  project:
    | { id: string; teamId: string; team: { organizationId: string } }
    | null,
  budgets: GatewayBudget[] = [],
  resolved?: ResolvedBudgetStub[],
): {
  deps: GatewayBudgetSyncReactorDeps;
  insertDebits: ReturnType<typeof vi.fn>;
} {
  const insertDebits = vi.fn().mockResolvedValue(undefined);
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
        // The reactor resolves buckets, not bare rows: a group budget
        // debits one member's bucket, not the whole group's.
        resolveForRequest: vi.fn().mockResolvedValue(
          resolved ??
            budgets.map((budget) => ({
              budget,
              bucketScopeId: budget.scopeId,
              principalUserId: null,
              groupId: null,
            })),
        ),
      } as any,
      budgetCHRepository: {
        insertDebits,
      } as any,
    },
    insertDebits,
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
      const { deps, insertDebits } = mockDeps(null, null, []);
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(event, ctx(createFoldState({})));

      expect(insertDebits).not.toHaveBeenCalled();
      expect(deps.prisma.virtualKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("when the VK is unknown", () => {
    it("logs + skips without writing to CH", async () => {
      const { deps, insertDebits } = mockDeps(null, null, []);
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

      expect(insertDebits).not.toHaveBeenCalled();
    });
  });

  describe("when the VK belongs to a different org", () => {
    it("logs + skips without writing to CH", async () => {
      const { deps, insertDebits } = mockDeps(
        { id: "vk-1", organizationId: "org-other", principalUserId: null },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
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

      expect(insertDebits).not.toHaveBeenCalled();
    });
  });

  describe("when the VK has no applicable budgets", () => {
    it("skips the CH write — no rows to fold", async () => {
      const { deps, insertDebits } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: null },
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

      expect(insertDebits).not.toHaveBeenCalled();
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

      const { deps, insertDebits } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: null },
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

      expect(insertDebits).toHaveBeenCalledTimes(1);
      const rows = insertDebits.mock.calls[0]![0];
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

  describe("when the VK has a per-member group budget", () => {
    it("debits the member's bucket, provider suffix included, not the group row", async () => {
      const budget = {
        id: "budget-grp",
        scopeType: "GROUP",
        scopeId: "grp-1",
        providerKey: "mp-openai",
        window: "MONTH",
      } as GatewayBudget;

      const { deps, insertDebits } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: "user-1" },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
        [budget],
        [
          {
            budget,
            // The bucket resolution service computes this shape; the
            // reactor must carry it into the row verbatim, because the
            // gateway and the spend readers match on exactly this id.
            bucketScopeId: "grp-1:user-1|provider:mp-openai",
            principalUserId: "user-1",
            groupId: "grp-1",
          },
        ],
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-grp-1",
            // The provider-filtered budget only accrues when the span
            // names the dispatched provider it filters on.
            "langwatch.model_provider_id": "mp-openai",
          }),
        ),
      );

      expect(insertDebits).toHaveBeenCalledTimes(1);
      const rows = insertDebits.mock.calls[0]![0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        budgetId: "budget-grp",
        scope: "GROUP",
        scopeId: "grp-1:user-1|provider:mp-openai",
        window: "MONTH",
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

      const { deps, insertDebits } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: null },
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

      expect(insertDebits).toHaveBeenCalledTimes(1);
      expect(insertDebits.mock.calls[0]![0][0]).toMatchObject({
        status: "BLOCKED_BY_GUARDRAIL",
        amountUsd: "0.0000000000",
      });
    });
  });

  describe("when the fold carries per-request gateway span entries", () => {
    const budget = {
      id: "budget-1",
      scopeType: "PROJECT",
      scopeId: "project-1",
      window: "MONTH",
    } as GatewayBudget;

    const entriesAttr = JSON.stringify([
      {
        requestId: "req-1",
        virtualKeyId: "vk-1",
        model: "openai/gpt-5-mini",
        modelProviderId: "mp-9",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 20540,
        cacheWriteTokens: 22994,
        reasoningTokens: 0,
        costUsd: 0.001,
        status: "success",
        errorClass: "",
        httpStatus: 0,
        endUserId: "",
        occurredAtMs: 1700_000_000_000,
        durationMs: 100,
      },
      {
        requestId: "req-2",
        virtualKeyId: "vk-1",
        model: "openai/gpt-5-mini",
        modelProviderId: "",
        inputTokens: 50,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        costUsd: 0.002,
        status: "error",
        errorClass: "provider_timeout",
        httpStatus: 504,
        endUserId: "",
        occurredAtMs: 1700_000_100_000,
        durationMs: 200,
      },
    ]);

    /** @scenario Cache read and cache write tokens are metered with real values */
    it("debits per request with real cache token classes and the provider id", async () => {
      const { deps, insertDebits } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: null },
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
            "langwatch.reserved.gateway_spans": entriesAttr,
          }),
        ),
      );

      expect(insertDebits).toHaveBeenCalledTimes(1);
      const rows = insertDebits.mock.calls[0]![0];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        gatewayRequestId: "req-1",
        amountUsd: "0.0010000000",
        tokensInput: 100,
        tokensCacheRead: 20540,
        tokensCacheWrite: 22994,
        providerKey: "mp-9",
        status: "SUCCESS",
        durationMs: 100,
      });
      expect(rows[1]).toMatchObject({
        gatewayRequestId: "req-2",
        amountUsd: "0.0020000000",
        status: "PROVIDER_ERROR",
        durationMs: 200,
      });
      expect(rows[0].occurredAt.getTime()).toBe(1700_000_000_000);
    });

    it("provider-filtered budgets accrue only the entries dispatched to their provider", async () => {
      const filtered = {
        id: "budget-openai",
        scopeType: "PROJECT",
        scopeId: "project-1",
        providerKey: "mp-openai",
        window: "MONTH",
      } as GatewayBudget;

      const { deps, insertDebits } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: null },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
        [filtered],
        [
          {
            budget: filtered,
            bucketScopeId: "project-1|provider:mp-openai",
            principalUserId: null,
            groupId: null,
          },
        ],
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      const mixedEntries = JSON.stringify([
        {
          requestId: "req-openai",
          virtualKeyId: "vk-1",
          model: "openai/gpt-5-mini",
          modelProviderId: "mp-openai",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          costUsd: 0.003,
          status: "success",
          errorClass: "",
          httpStatus: 0,
          endUserId: "",
          occurredAtMs: 1700_000_000_000,
          durationMs: 80,
        },
        {
          requestId: "req-anthropic",
          virtualKeyId: "vk-1",
          model: "anthropic/claude-sonnet-5",
          modelProviderId: "mp-anthropic",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          costUsd: 0.004,
          status: "success",
          errorClass: "",
          httpStatus: 0,
          endUserId: "",
          occurredAtMs: 1700_000_050_000,
          durationMs: 90,
        },
      ]);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-openai",
            "langwatch.reserved.gateway_spans": mixedEntries,
          }),
        ),
      );

      expect(insertDebits).toHaveBeenCalledTimes(1);
      const rows = insertDebits.mock.calls[0]![0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        budgetId: "budget-openai",
        gatewayRequestId: "req-openai",
        scopeId: "project-1|provider:mp-openai",
        providerKey: "mp-openai",
        amountUsd: "0.0030000000",
      });
    });
  });
});
