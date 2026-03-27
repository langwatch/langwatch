import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NurturingService } from "../../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../../app-layer/projects/project.service";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createCustomerIoTraceSyncReactor,
  type CustomerIoTraceSyncReactorDeps,
} from "../customerIoTraceSync.reactor";

// Suppress logger output
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
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
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
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    hasAnnotation: null,
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: {},
    ...overrides,
  };
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

function createContext(
  foldState: TraceSummaryData,
  tenantId = "project-1",
): ReactorContext<TraceSummaryData> {
  return {
    tenantId,
    aggregateId: "trace-1",
    foldState,
  };
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

function createDeps(
  overrides: Partial<CustomerIoTraceSyncReactorDeps> = {},
): CustomerIoTraceSyncReactorDeps {
  return {
    projects: createMockProjectService(),
    nurturing: createMockNurturing(),
    ...overrides,
  };
}

describe("customerIoTraceSync reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("makeJobId", () => {
    it("returns cio-trace-sync-{projectId}", () => {
      const deps = createDeps();
      const reactor = createCustomerIoTraceSyncReactor(deps);
      const event = createEvent({ tenantId: "project-42" });

      const jobId = reactor.options!.makeJobId!({
        event,
        foldState: createFoldState(),
      });

      expect(jobId).toBe("cio-trace-sync-project-42");
    });
  });

  describe("given a project that has never received a trace", () => {
    describe("when the first trace is processed", () => {
      it("identifies user with has_traces true, sdk metadata, and trace timestamp", async () => {
        const deps = createDeps();
        const reactor = createCustomerIoTraceSyncReactor(deps);
        const traceTime = new Date("2026-03-15T10:00:00Z").getTime();
        const state = createFoldState({
          occurredAt: traceTime,
          attributes: {
            "sdk.language": "python",
            "langwatch.sdk.framework": "openai",
          },
        });

        await reactor.handle(createEvent(), createContext(state));

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

      it("tracks first_trace_integrated event", async () => {
        const deps = createDeps();
        const reactor = createCustomerIoTraceSyncReactor(deps);
        const state = createFoldState({
          attributes: {
            "sdk.language": "python",
            "langwatch.sdk.framework": "openai",
          },
        });

        await reactor.handle(createEvent(), createContext(state));

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
      it("identifies user with last_trace_at", async () => {
        const deps = createDeps({
          projects: createMockProjectService({
            resolveOrgAdmin: vi.fn().mockResolvedValue({
              userId: "user-1",
              organizationId: "org-1",
              firstMessage: true,
            }),
          }),
        });
        const reactor = createCustomerIoTraceSyncReactor(deps);
        const traceTime = new Date("2026-03-15T10:00:00Z").getTime();
        const state = createFoldState({ spanCount: 5, occurredAt: traceTime });

        await reactor.handle(createEvent(), createContext(state));

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
        const reactor = createCustomerIoTraceSyncReactor(deps);
        const state = createFoldState({ spanCount: 5 });

        await reactor.handle(createEvent(), createContext(state));

        expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project is not found", () => {
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
      const reactor = createCustomerIoTraceSyncReactor(deps);

      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
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
      const reactor = createCustomerIoTraceSyncReactor(deps);

      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
    });
  });

  describe("given the nurturing service throws", () => {
    it("does not propagate the error", async () => {
      const nurturing = createMockNurturing();
      vi.mocked(nurturing.identifyUser).mockRejectedValue(
        new Error("CIO down"),
      );
      const deps = createDeps({ nurturing });
      const reactor = createCustomerIoTraceSyncReactor(deps);

      // Should not throw
      await expect(
        reactor.handle(createEvent(), createContext(createFoldState())),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the first trace is detected via firstMessage flag", () => {
    it("calls resolveOrgAdmin on the project service", async () => {
      const deps = createDeps();
      const reactor = createCustomerIoTraceSyncReactor(deps);

      await reactor.handle(createEvent(), createContext(createFoldState()));

      expect(deps.projects.resolveOrgAdmin).toHaveBeenCalledWith("project-1");
    });
  });
});
