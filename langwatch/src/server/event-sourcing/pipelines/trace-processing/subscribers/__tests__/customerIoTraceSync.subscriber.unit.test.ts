import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NurturingService } from "@ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { CIO_SYNC_DEBOUNCE_TTL_MS } from "../../../shared/nurtureSync";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  type CustomerIoTraceSyncSubscriberDeps,
  createCustomerIoTraceSyncSubscriber,
} from "../customerIoTraceSync.subscriber";

// Suppress logger output
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

function createSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hello",
    computedOutput: "world",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
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
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: {},
    ...overrides,
  } as TraceSummaryData;
}

function createEvent(
  overrides: Record<string, unknown> = {},
): TraceProcessingEvent {
  return {
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
    ...overrides,
  } as unknown as TraceProcessingEvent;
}

function createContext(tenantId = "project-1"): EventSubscriberContext {
  return { tenantId, aggregateId: "trace-1" };
}

function createMockNurturing(): NurturingService {
  return {
    identifyUser: vi.fn().mockResolvedValue(undefined),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    groupUser: vi.fn().mockResolvedValue(undefined),
    batch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NurturingService;
}

function createMockProjectService(
  overrides: Partial<{ resolveOrgAdmin: ReturnType<typeof vi.fn> }> = {},
): ProjectService {
  return {
    resolveOrgAdmin: vi.fn().mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      firstMessage: false,
    }),
    ...overrides,
  } as unknown as ProjectService;
}

function createMockTraceSummaryStore(
  summary: TraceSummaryData | null = createSummary(),
): FoldProjectionStore<TraceSummaryData> {
  return {
    get: vi.fn().mockResolvedValue(summary),
    store: vi.fn().mockResolvedValue(undefined),
  } as unknown as FoldProjectionStore<TraceSummaryData>;
}

function createDeps(
  overrides: Partial<CustomerIoTraceSyncSubscriberDeps> = {},
): CustomerIoTraceSyncSubscriberDeps {
  return {
    projects: createMockProjectService(),
    nurturing: createMockNurturing(),
    traceSummaryStore: createMockTraceSummaryStore(),
    ...overrides,
  };
}

describe("customerIoTraceSync subscriber", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("deduplication", () => {
    /** @scenario 'Trace sync reactor uses project-scoped job ID for debouncing' */
    it("keys the dedup window on cio-trace-sync-{projectId}", () => {
      const subscriber = createCustomerIoTraceSyncSubscriber(createDeps());
      const dedup = subscriber.options?.deduplication;
      if (!dedup || dedup === "aggregate") {
        throw new Error("expected a custom deduplication config");
      }

      expect(dedup.makeId(createEvent({ tenantId: "project-42" }))).toBe(
        "cio-trace-sync-project-42",
      );
    });

    /** @scenario 'Subsequent traces update count and timestamp with debouncing' */
    it("debounces over the shared Customer.io window", () => {
      const subscriber = createCustomerIoTraceSyncSubscriber(createDeps());
      const dedup = subscriber.options?.deduplication;
      if (!dedup || dedup === "aggregate") {
        throw new Error("expected a custom deduplication config");
      }

      expect(dedup.ttlMs).toBe(CIO_SYNC_DEBOUNCE_TTL_MS);
      // extend/replace stay unset so the queue defaults (both true) apply —
      // the same window the reactor's `ttl` resolved to.
      expect(dedup.extend).toBeUndefined();
      expect(dedup.replace).toBeUndefined();
    });
  });

  describe("event types", () => {
    it("subscribes to genuine trace message events only", () => {
      const subscriber = createCustomerIoTraceSyncSubscriber(createDeps());

      expect(subscriber.eventTypes).toEqual([
        "lw.obs.trace.span_received",
        "lw.obs.trace.origin_resolved",
      ]);
    });
  });

  describe("given a project that has never received a trace", () => {
    describe("when the first trace is processed", () => {
      /** @scenario 'First trace identifies user with trace milestones' */
      /** @scenario 'First trace fires immediately without debouncing' */
      it("identifies user with has_traces true, sdk metadata, and trace timestamp", async () => {
        const traceTime = new Date("2026-03-15T10:00:00Z").getTime();
        const deps = createDeps({
          traceSummaryStore: createMockTraceSummaryStore(
            createSummary({
              occurredAt: traceTime,
              attributes: {
                "sdk.language": "python",
                "langwatch.sdk.framework": "openai",
              },
            }),
          ),
        });
        const subscriber = createCustomerIoTraceSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            has_traces: true,
            sdk_language: "python",
            sdk_framework: "openai",
            first_trace_at: "2026-03-15T10:00:00.000Z",
          }),
        });
      });

      /** @scenario 'First trace fires first_trace_integrated event' */
      it("tracks first_trace_integrated event", async () => {
        const deps = createDeps({
          traceSummaryStore: createMockTraceSummaryStore(
            createSummary({
              attributes: {
                "sdk.language": "python",
                "langwatch.sdk.framework": "openai",
              },
            }),
          ),
        });
        const subscriber = createCustomerIoTraceSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "first_trace_integrated",
          properties: expect.objectContaining({
            sdk_language: "python",
            sdk_framework: "openai",
            project_id: "project-1",
          }),
        });
      });
    });
  });

  describe("given a project that already has traces", () => {
    describe("when a new trace is processed", () => {
      /** @scenario 'Subsequent traces update count and timestamp with debouncing' */
      it("identifies user with last_trace_at", async () => {
        const traceTime = new Date("2026-03-15T10:00:00Z").getTime();
        const deps = createDeps({
          projects: createMockProjectService({
            resolveOrgAdmin: vi.fn().mockResolvedValue({
              userId: "user-1",
              organizationId: "org-1",
              firstMessage: true,
            }),
          }),
          traceSummaryStore: createMockTraceSummaryStore(
            createSummary({ spanCount: 5, occurredAt: traceTime }),
          ),
        });
        const subscriber = createCustomerIoTraceSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: {
            last_trace_at: "2026-03-15T10:00:00.000Z",
          },
        });
      });

      it("does not track first_trace_integrated event", async () => {
        const deps = createDeps({
          projects: createMockProjectService({
            resolveOrgAdmin: vi.fn().mockResolvedValue({
              userId: "user-1",
              organizationId: "org-1",
              firstMessage: true,
            }),
          }),
        });
        const subscriber = createCustomerIoTraceSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

        expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the trace summary is not readable", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps({
        traceSummaryStore: createMockTraceSummaryStore(null),
      });
      const subscriber = createCustomerIoTraceSyncSubscriber(deps);

      await subscriber.handle(createEvent(), createContext());

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });

    it("reads the fold back for the event's own trace and tenant", async () => {
      const deps = createDeps();
      const subscriber = createCustomerIoTraceSyncSubscriber(deps);

      await subscriber.handle(createEvent(), createContext());

      expect(deps.traceSummaryStore.get).toHaveBeenCalledWith(
        "trace-1",
        expect.objectContaining({
          aggregateId: "trace-1",
          tenantId: "project-1",
        }),
      );
    });
  });

  describe("given no admin user found", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps({
        projects: createMockProjectService({
          resolveOrgAdmin: vi.fn().mockResolvedValue({
            userId: null,
            organizationId: null,
            firstMessage: false,
          }),
        }),
      });
      const subscriber = createCustomerIoTraceSyncSubscriber(deps);

      await subscriber.handle(createEvent(), createContext());

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the nurturing service throws", () => {
    it("does not propagate the error", async () => {
      const nurturing = createMockNurturing();
      vi.mocked(nurturing.identifyUser).mockRejectedValue(
        new Error("CIO down"),
      );
      const deps = createDeps({ nurturing });
      const subscriber = createCustomerIoTraceSyncSubscriber(deps);

      await expect(
        subscriber.handle(createEvent(), createContext()),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the trace summary store throws", () => {
    it("does not propagate the error", async () => {
      const traceSummaryStore = createMockTraceSummaryStore();
      vi.mocked(traceSummaryStore.get).mockRejectedValue(
        new Error("ClickHouse down"),
      );
      const deps = createDeps({ traceSummaryStore });
      const subscriber = createCustomerIoTraceSyncSubscriber(deps);

      await expect(
        subscriber.handle(createEvent(), createContext()),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the first trace is detected via firstMessage flag", () => {
    /** @scenario 'Trace sync does not duplicate first-trace detection logic' */
    it("calls resolveOrgAdmin on the project service", async () => {
      const deps = createDeps();
      const subscriber = createCustomerIoTraceSyncSubscriber(deps);

      await subscriber.handle(createEvent(), createContext());

      expect(deps.projects.resolveOrgAdmin).toHaveBeenCalledWith("project-1");
    });
  });
});
