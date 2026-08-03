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
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
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
  vk: {
    id: string;
    organizationId: string;
    principalUserId: string | null;
  } | null,
  project: {
    id: string;
    teamId: string;
    team: { organizationId: string };
  } | null,
  budgets: GatewayBudget[] = [],
  resolved?: ResolvedBudgetStub[],
): {
  deps: GatewayBudgetSyncReactorDeps;
  insertDebitsForBudgets: ReturnType<typeof vi.fn>;
} {
  const insertDebitsForBudgets = vi.fn().mockResolvedValue(undefined);
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
        insertDebitsForBudgets,
      } as any,
    },
    insertDebitsForBudgets,
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
      const { deps, insertDebitsForBudgets } = mockDeps(null, null, []);
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(event, ctx(createFoldState({})));

      expect(insertDebitsForBudgets).not.toHaveBeenCalled();
      expect(deps.prisma.virtualKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("when the VK is unknown", () => {
    it("logs + skips without writing to CH", async () => {
      const { deps, insertDebitsForBudgets } = mockDeps(null, null, []);
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

      expect(insertDebitsForBudgets).not.toHaveBeenCalled();
    });
  });

  describe("when the VK belongs to a different org", () => {
    it("logs + skips without writing to CH", async () => {
      const { deps, insertDebitsForBudgets } = mockDeps(
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

      expect(insertDebitsForBudgets).not.toHaveBeenCalled();
    });
  });

  describe("when the VK has no applicable budgets", () => {
    it("skips the CH write — no rows to fold", async () => {
      const { deps, insertDebitsForBudgets } = mockDeps(
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

      expect(insertDebitsForBudgets).not.toHaveBeenCalled();
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

      const { deps, insertDebitsForBudgets } = mockDeps(
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

      expect(insertDebitsForBudgets).toHaveBeenCalledTimes(1);
      const rows = insertDebitsForBudgets.mock.calls[0]![0];
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

      const { deps, insertDebitsForBudgets } = mockDeps(
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

      expect(insertDebitsForBudgets).toHaveBeenCalledTimes(1);
      const rows = insertDebitsForBudgets.mock.calls[0]![0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        budgetId: "budget-grp",
        scope: "GROUP",
        scopeId: "grp-1:user-1|provider:mp-openai",
        window: "MONTH",
      });
    });
  });

  describe("when the VK carries an attributed-user template", () => {
    /** @scenario The trace fold never debits an attributed-user template */
    it("writes the key cap's row and leaves the template to its own writer", async () => {
      const template = {
        id: "budget-template",
        scopeType: "ATTRIBUTED_USER",
        scopeId: "vk-1",
        window: "MONTH",
      } as GatewayBudget;
      const keyCap = {
        id: "budget-key",
        scopeType: "VIRTUAL_KEY",
        scopeId: "vk-1",
        window: "MONTH",
      } as GatewayBudget;

      const { deps, insertDebitsForBudgets } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: null },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
        [template, keyCap],
        // The fold has no end user, so the resolver hands the template
        // back keyed on its bare anchor: the shape that collides.
        [
          {
            budget: template,
            bucketScopeId: "vk-1",
            principalUserId: null,
            groupId: null,
          },
          {
            budget: keyCap,
            bucketScopeId: "vk-1",
            principalUserId: null,
            groupId: null,
          },
        ],
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-tpl-1",
          }),
        ),
      );

      expect(insertDebitsForBudgets).toHaveBeenCalledTimes(1);
      const rows = insertDebitsForBudgets.mock.calls[0]![0];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        budgetId: "budget-key",
        scope: "VIRTUAL_KEY",
      });
      expect(
        rows.some((r: { scope: string }) => r.scope === "ATTRIBUTED_USER"),
      ).toBe(false);
    });

    it("writes nothing at all when the template is the only budget", async () => {
      const template = {
        id: "budget-template",
        scopeType: "ATTRIBUTED_USER",
        scopeId: "vk-1",
        window: "MONTH",
      } as GatewayBudget;

      const { deps, insertDebitsForBudgets } = mockDeps(
        { id: "vk-1", organizationId: "org-1", principalUserId: null },
        {
          id: "project-1",
          teamId: "team-1",
          team: { organizationId: "org-1" },
        },
        [template],
        [
          {
            budget: template,
            bucketScopeId: "vk-1",
            principalUserId: null,
            groupId: null,
          },
        ],
      );
      const reactor = createGatewayBudgetSyncReactor(deps);

      await reactor.handle(
        event,
        ctx(
          createFoldState({
            "langwatch.virtual_key_id": "vk-1",
            "langwatch.gateway_request_id": "req-tpl-2",
          }),
        ),
      );

      expect(insertDebitsForBudgets).not.toHaveBeenCalled();
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

      const { deps, insertDebitsForBudgets } = mockDeps(
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

      expect(insertDebitsForBudgets).toHaveBeenCalledTimes(1);
      expect(insertDebitsForBudgets.mock.calls[0]![0][0]).toMatchObject({
        status: "BLOCKED_BY_GUARDRAIL",
        amountUsd: "0.0000000000",
      });
    });
  });
});
