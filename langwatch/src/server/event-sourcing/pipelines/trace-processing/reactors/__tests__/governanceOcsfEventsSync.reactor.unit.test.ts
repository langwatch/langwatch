/**
 * GovernanceOcsfEventsSyncReactor — unit tests with a mocked CH repository.
 *
 * Sergey commit ee5159879 (step 3d-ii) shipped the reactor that folds
 * governance-origin trace fold-completions into per-event OCSF v1.1
 * rows in the governance_ocsf_events ClickHouse table.
 *
 * This test exercises the reactor's decision logic with a stubbed
 * GovernanceOcsfEventsClickHouseRepository — no testcontainers needed.
 *
 * Coverage:
 *   - Skips traces with no origin.kind attribute (application path)
 *   - Skips traces with origin.kind != "ingestion_source"
 *   - Skips traces with missing langwatch.ingestion_source.id
 *   - Skips traces with occurredAt = 0 (sentinel; fold has no spans yet)
 *   - Inserts a full OCSF row with all fields populated when origin
 *     attrs + actor identity + target model are present
 *   - Severity defaults to INFO when no anomaly_alert_id is set
 *   - Severity elevates to MEDIUM when langwatch.governance.anomaly_alert_id
 *     IS set (per the spec scenario)
 *   - ActionName falls back to "trace.recorded" when tool.name missing
 *   - TargetName falls back from gen_ai.request.model → models[0] → ""
 *   - EventId equals foldState.traceId (one OCSF row per trace)
 *   - Repository errors captured + suppressed (reactor failures must
 *     NOT block the trace pipeline)
 *   - Job-id dedup contract: per-(tenant, trace) with positive TTL
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
 *   - specs/ai-gateway/governance/siem-export.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  type GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "~/server/governance/governanceOcsfEvents.clickhouse.repository";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createGovernanceOcsfEventsSyncReactor,
  type GovernanceOcsfEventsSyncReactorDeps,
} from "../governanceOcsfEventsSync.reactor";

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

const FIXED_OCCURRED_AT_MS = 1_700_000_000_000;

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
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    lastEventOccurredAt: 0,
    occurredAt: FIXED_OCCURRED_AT_MS,
    createdAt: FIXED_OCCURRED_AT_MS,
    updatedAt: FIXED_OCCURRED_AT_MS,
    attributes,
    ...overrides,
  } as TraceSummaryData;
}

const event: TraceProcessingEvent = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: "gov-project-1",
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

function mockDeps(): {
  deps: GovernanceOcsfEventsSyncReactorDeps;
  insertEvent: ReturnType<typeof vi.fn>;
} {
  const insertEvent = vi.fn().mockResolvedValue(undefined);
  return {
    deps: {
      governanceOcsfEventsRepository: {
        insertEvent,
      } as unknown as GovernanceOcsfEventsClickHouseRepository,
    },
    insertEvent,
  };
}

function ctx(foldState: TraceSummaryData): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "gov-project-1",
    aggregateId: "trace-1",
    foldState,
  };
}

describe("governanceOcsfEventsSync reactor", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the trace has no governance origin attributes", () => {
    it("skips silently — application traces never reach OCSF export", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      await reactor.handle(event, ctx(createFoldState({})));
      expect(insertEvent).not.toHaveBeenCalled();
    });
  });

  describe("when langwatch.origin.kind is not 'ingestion_source'", () => {
    it("skips — origin.kind is reserved for governance ingest only", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      await reactor.handle(
        event,
        ctx(createFoldState({ "langwatch.origin.kind": "personal_workspace" })),
      );
      expect(insertEvent).not.toHaveBeenCalled();
    });
  });

  describe("when origin.kind is set but ingestion_source.id is missing", () => {
    it("warns + skips — defensive against malformed governance traffic", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      await reactor.handle(
        event,
        ctx(createFoldState({ "langwatch.origin.kind": "ingestion_source" })),
      );
      expect(insertEvent).not.toHaveBeenCalled();
    });
  });

  describe("when occurredAt is the initial sentinel (0)", () => {
    it("skips — fold has not yet observed any spans", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      await reactor.handle(
        event,
        ctx(
          createFoldState(
            {
              "langwatch.origin.kind": "ingestion_source",
              "langwatch.ingestion_source.id": "is-1",
            },
            { occurredAt: 0 },
          ),
        ),
      );
      expect(insertEvent).not.toHaveBeenCalled();
    });
  });

  describe("when origin attributes + actor + target are fully present", () => {
    it("inserts a full OCSF row with all fields populated", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-1",
        "langwatch.ingestion_source.source_type": "claude_cowork",
        "langwatch.user_id": "user-42",
        "user.email": "engineer@acme.example.com",
        "enduser.id": "enduser-99",
        "tool.name": "search_logs",
        "gen_ai.request.model": "claude-sonnet-4",
      });

      await reactor.handle(event, ctx(state));

      expect(insertEvent).toHaveBeenCalledTimes(1);
      const [row] = insertEvent.mock.calls[0]!;
      expect(row.tenantId).toBe("gov-project-1");
      expect(row.eventId).toBe("trace-1");
      expect(row.traceId).toBe("trace-1");
      expect(row.sourceId).toBe("is-1");
      expect(row.sourceType).toBe("claude_cowork");
      expect(row.activityId).toBe(OCSF_ACTIVITY.INVOKE);
      expect(row.severityId).toBe(OCSF_SEVERITY.INFO);
      expect(row.actorUserId).toBe("user-42");
      expect(row.actorEmail).toBe("engineer@acme.example.com");
      expect(row.actorEnduserId).toBe("enduser-99");
      expect(row.actionName).toBe("search_logs");
      expect(row.targetName).toBe("claude-sonnet-4");
      expect(row.anomalyAlertId).toBe("");
      expect(row.eventTime.getTime()).toBe(FIXED_OCCURRED_AT_MS);
    });

    it("emits valid OCSF JSON in rawOcsfJson", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-1",
        "langwatch.ingestion_source.source_type": "otel_generic",
        "langwatch.user_id": "user-42",
      });
      await reactor.handle(event, ctx(state));
      const [row] = insertEvent.mock.calls[0]!;
      const parsed = JSON.parse(row.rawOcsfJson);
      expect(parsed.class_uid).toBe(6003);
      expect(parsed.category_uid).toBe(6);
      expect(parsed.activity_id).toBe(OCSF_ACTIVITY.INVOKE);
      expect(parsed.type_uid).toBe(6003 * 100 + OCSF_ACTIVITY.INVOKE);
      expect(parsed.severity_id).toBe(OCSF_SEVERITY.INFO);
      expect(parsed.actor.user.uid).toBe("user-42");
      expect(parsed.metadata.product.name).toBe("LangWatch");
    });
  });

  describe("severity elevation per spec scenario", () => {
    it("elevates severity to MEDIUM when langwatch.governance.anomaly_alert_id is set", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-1",
        "langwatch.ingestion_source.source_type": "claude_cowork",
        "langwatch.governance.anomaly_alert_id": "alert-anomaly-123",
      });
      await reactor.handle(event, ctx(state));
      const [row] = insertEvent.mock.calls[0]!;
      expect(row.severityId).toBe(OCSF_SEVERITY.MEDIUM);
      expect(row.anomalyAlertId).toBe("alert-anomaly-123");
    });
  });

  describe("when tool.name is missing", () => {
    it("falls back ActionName to 'trace.recorded'", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-1",
        "langwatch.ingestion_source.source_type": "otel_generic",
      });
      await reactor.handle(event, ctx(state));
      const [row] = insertEvent.mock.calls[0]!;
      expect(row.actionName).toBe("trace.recorded");
    });
  });

  describe("TargetName fallback chain", () => {
    it("prefers gen_ai.request.model when present", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-1",
        "gen_ai.request.model": "claude-haiku-4-5",
      });
      await reactor.handle(event, ctx(state));
      const [row] = insertEvent.mock.calls[0]!;
      expect(row.targetName).toBe("claude-haiku-4-5");
    });

    it("falls back to foldState.models[0] when gen_ai.request.model missing", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState(
        {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.ingestion_source.id": "is-1",
        },
        { models: ["fallback-model"] },
      );
      await reactor.handle(event, ctx(state));
      const [row] = insertEvent.mock.calls[0]!;
      expect(row.targetName).toBe("fallback-model");
    });

    it("falls back to '' when no model info available", async () => {
      const { deps, insertEvent } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState(
        {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.ingestion_source.id": "is-1",
        },
        { models: [] },
      );
      await reactor.handle(event, ctx(state));
      const [row] = insertEvent.mock.calls[0]!;
      expect(row.targetName).toBe("");
    });
  });

  describe("when the repository throws", () => {
    it("captures the exception without rethrowing — reactor failures must not block the trace pipeline", async () => {
      const insertEvent = vi
        .fn()
        .mockRejectedValue(new Error("CH connection failed"));
      const deps: GovernanceOcsfEventsSyncReactorDeps = {
        governanceOcsfEventsRepository: {
          insertEvent,
        } as unknown as GovernanceOcsfEventsClickHouseRepository,
      };
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-1",
      });
      await expect(reactor.handle(event, ctx(state))).resolves.toBeUndefined();
      expect(insertEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("dedup contract", () => {
    it("declares a per-(tenant, trace) job-id for BullMQ debounce", () => {
      const { deps } = mockDeps();
      const reactor = createGovernanceOcsfEventsSyncReactor(deps);
      expect(reactor.options?.makeJobId).toBeDefined();
      const jobId = reactor.options!.makeJobId!({
        event: { tenantId: "t-1", aggregateId: "trace-x" },
      } as any);
      expect(jobId).toBe("governance-ocsf-events-sync-t-1-trace-x");
      expect(reactor.options?.ttl).toBeGreaterThan(0);
    });
  });
});
