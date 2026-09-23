import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

/** The injected product-analytics sink; the subscriber never reaches a client itself. */
const mockTrackServerEvent = vi.fn();

import { createTenantId, type TriggerContext } from "@langwatch/eventing";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  type OtlpSpan,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

import {
  type ProjectMetadataSubscriberDeps,
  ProjectMetadataSync,
} from "../project-metadata.subscriber.ts";

function createFoldState(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
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
  };
}

function otlpSpan(): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: null,
    name: "main",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [],
    events: [],
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function createEvent(tenantId: string): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: createTenantId(tenantId),
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span: otlpSpan(),
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  };
}

function createContext(
  tenantId: string,
  state: TraceSummaryData,
): TriggerContext<TraceSummaryData> {
  return {
    tenantId,
    aggregateId: "trace-1",
    state,
  };
}

function createMockProjectService() {
  return {
    findById: vi.fn(),
    findWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    isFeatureEnabled: vi.fn(),
    resolveOrgAdmin: vi.fn().mockResolvedValue({
      userId: "admin-user-1",
      organizationId: "org-1",
      firstMessage: false,
    }),
    repo: {} as any,
  };
}

describe("ProjectMetadataSync.createProjectMetadataHandler()", () => {
  let deps: ProjectMetadataSubscriberDeps;
  let mockProjects: ReturnType<typeof createMockProjectService>;
  const tenantId = "project-123";

  beforeEach(() => {
    logger.error.mockClear();
    logger.warn.mockClear();
    mockTrackServerEvent.mockClear();
    mockProjects = createMockProjectService();
    deps = {
      projects: mockProjects as any,
      recordProductEvent: mockTrackServerEvent,
    };
  });

  describe("when project has not received first message", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    /** @scenario "Project marks as integrated after first trace ingestion" */
    it("sets firstMessage to true", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ firstMessage: true }),
      });
    });

    it("sets integrated to true for non-optimization-studio traces", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ integrated: true }),
      });
    });

    /** @scenario First trace tracks the PostHog integration milestone against the org admin */
    it("tracks first_trace_integrated against the org admin", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const state = createFoldState({
        attributes: {
          "sdk.language": "python",
          "langwatch.sdk.framework": "openai",
        },
      });

      await subscriber(event, createContext(tenantId, state));

      expect(mockTrackServerEvent).toHaveBeenCalledTimes(1);
      expect(mockTrackServerEvent).toHaveBeenCalledWith({
        userId: "admin-user-1",
        event: "first_trace_integrated",
        properties: {
          sdk_language: "python",
          sdk_framework: "openai",
        },
        projectId: tenantId,
      });
    });

    /** @scenario PostHog integration milestone reports unknown when SDK attributes are absent */
    it("falls back to unknown sdk properties when attributes are absent", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);

      await subscriber(event, createContext(tenantId, createFoldState()));

      expect(mockTrackServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: {
            sdk_language: "unknown",
            sdk_framework: "unknown",
          },
        }),
      );
    });

    /** @scenario PostHog integration milestone is skipped when the project has no org admin */
    it("does not track first_trace_integrated when no admin user is found", async () => {
      mockProjects.resolveOrgAdmin.mockResolvedValue({
        userId: null,
        organizationId: null,
        firstMessage: false,
      });
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);

      await subscriber(event, createContext(tenantId, createFoldState()));

      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when sdk.language is python", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    it("detects language as python from state attributes", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const state = createFoldState({
        attributes: { "sdk.language": "python" },
      });
      const context = createContext(tenantId, state);

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "python" }),
      });
    });
  });

  describe("when sdk.language is typescript", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    it("detects language as typescript from state attributes", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const state = createFoldState({
        attributes: { "sdk.language": "typescript" },
      });
      const context = createContext(tenantId, state);

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "typescript" }),
      });
    });
  });

  describe("when sdk.language is not recognized", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    it("falls back to 'other'", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const state = createFoldState({
        attributes: { "sdk.language": "java" },
      });
      const context = createContext(tenantId, state);

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "other" }),
      });
    });
  });

  describe("when project is already fully integrated", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: true,
      });
    });

    beforeEach(async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);
    });

    it("does not update the project", async () => {
      expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
    });

    /** @scenario PostHog integration milestone fires only on the firstMessage transition */
    it("does not track first_trace_integrated again", async () => {
      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("when project is not found", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue(null);
    });

    it("does not update the project", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when platform is optimization_studio", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    beforeEach(async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const state = createFoldState({
        attributes: { "langwatch.platform": "optimization_studio" },
      });
      const context = createContext(tenantId, state);

      await subscriber(event, context);
    });

    it("does not set integrated to true", async () => {
      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ integrated: false }),
      });
    });

    it("sets language to 'other'", async () => {
      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "other" }),
      });
    });
  });

  describe("when updateMetadata throws", () => {
    let subscriber: ReturnType<typeof ProjectMetadataSync.createProjectMetadataHandler>;
    let event: TraceProcessingEvent;
    let context: TriggerContext<TraceSummaryData>;

    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockRejectedValue(new Error("database error"));
      subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);
      event = createEvent(tenantId);
      context = createContext(tenantId, createFoldState());
    });

    it("swallows the error (non-fatal)", async () => {
      // Must not throw
      await expect(subscriber(event, context)).resolves.toBeUndefined();
    });

    /** @scenario PostHog integration milestone is not tracked when the metadata write fails */
    it("does not track first_trace_integrated for a failed write", async () => {
      // The next trace retries the write and fires the event then.
      await subscriber(event, context);

      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("given a project receiving its first real trace", () => {
    let bootstrapTopicClustering: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
      bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
      deps = {
        projects: mockProjects as any,
        recordProductEvent: mockTrackServerEvent,
        bootstrapTopicClustering: bootstrapTopicClustering as any,
      };
    });

    describe("when a topic clustering bootstrap is wired", () => {
      it("bootstraps the project's clustering schedule exactly once", async () => {
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(bootstrapTopicClustering).toHaveBeenCalledTimes(1);
        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
      });

      it("bootstraps independently of the metadata write", async () => {
        // The bootstrap is no longer sequenced behind the metadata write: it
        // has to run for projects whose metadata needs no update at all. Its
        // own try/catch, not its position, is what keeps a bootstrap failure
        // from being reported as a metadata failure.
        mockProjects.updateMetadata.mockRejectedValue(new Error("pg down"));
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
      });
    });

    describe("when the project is already marked as integrated", () => {
      it("still re-asserts the clustering schedule", async () => {
        // The regression that made a deploy-time backfill necessary: an
        // established project returned early, so a project that lost its
        // schedule never got it back from ingest. Bootstrap is level-triggered
        // now, so every real trace re-asserts it.
        mockProjects.findById.mockResolvedValue({
          id: tenantId,
          firstMessage: true,
          integrated: true,
        });
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
        // Still no redundant metadata write for an already-marked project.
        expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
      });
    });

    describe("when the bootstrap throws", () => {
      beforeEach(() => {
        bootstrapTopicClustering.mockRejectedValue(new Error("process store unavailable"));
      });

      it("swallows the failure (non-fatal)", async () => {
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);

        await expect(
          subscriber(createEvent(tenantId), createContext(tenantId, createFoldState())),
        ).resolves.toBeUndefined();
      });

      it("does not report the committed metadata write as failed", async () => {
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
        const [, message] = logger.error.mock.calls[0]!;
        expect(message).toMatch(/bootstrap failed/i);
        expect(message).not.toMatch(/Failed to update project metadata/i);
      });
    });

    describe("when no bootstrap is wired", () => {
      it("completes the metadata write without error", async () => {
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler({
          projects: mockProjects as any,
          recordProductEvent: mockTrackServerEvent,
        });

        await expect(
          subscriber(createEvent(tenantId), createContext(tenantId, createFoldState())),
        ).resolves.toBeUndefined();

        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a project that already received its first message", () => {
    let bootstrapTopicClustering: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Not yet integrated, so the subscriber still writes metadata. The
      // bootstrap is no longer gated on the first-message transition.
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
      bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
      deps = {
        projects: mockProjects as any,
        recordProductEvent: mockTrackServerEvent,
        bootstrapTopicClustering: bootstrapTopicClustering as any,
      };
    });

    describe("when another trace arrives", () => {
      beforeEach(async () => {
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));
      });

      it("updates the metadata and re-asserts the clustering schedule", async () => {
        // Re-asserting is the point: it is idempotent at the process (a
        // bootstrap-trigger request cannot move the wake or start a run) and
        // rate-limited at the injected implementation, so the reconciliation
        // costs at most one commit per project per claim window.
        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
      });

      it("does not track first_trace_integrated for the repeat write", async () => {
        // The event is gated on the firstMessage transition, not on the
        // metadata write: an integrated-flag repair must not re-fire it.
        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
        expect(mockTrackServerEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project no longer exists", () => {
    describe("when a trace arrives", () => {
      it("does not bootstrap clustering", async () => {
        const bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
        mockProjects.findById.mockResolvedValue(null);
        const subscriber = ProjectMetadataSync.createProjectMetadataHandler({
          projects: mockProjects as any,
          recordProductEvent: mockTrackServerEvent,
          bootstrapTopicClustering: bootstrapTopicClustering as any,
        });

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(bootstrapTopicClustering).not.toHaveBeenCalled();
      });
    });
  });

  // The window / dedup / lane wiring lives on the pipeline registration now —
  // see subscriberWiring.unit.test.ts for those assertions.

  describe("when deciding whether the ingest is real", () => {
    describe("when the trace is a real ingest", () => {
      it("returns true", () => {
        const state = createFoldState({
          attributes: { "langwatch.origin": "application" },
        });

        expect(ProjectMetadataSync.isRealFirstIngest(state)).toBe(true);
      });
    });

    describe("when the trace is a seeded sample", () => {
      it("returns false", () => {
        const state = createFoldState({
          attributes: { "langwatch.origin": "sample" },
        });

        expect(ProjectMetadataSync.isRealFirstIngest(state)).toBe(false);
      });
    });

    describe("when the trace is one of Langy's own turns", () => {
      it("returns false", () => {
        const state = createFoldState({
          attributes: { "langwatch.origin": "langy" },
        });

        expect(ProjectMetadataSync.isRealFirstIngest(state)).toBe(false);
      });
    });
  });

  describe("given an injected active-day tracker", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: true,
      });
    });

    it("marks the project's active day before reading the project", async () => {
      const calls: string[] = [];
      const trackActiveDay = vi.fn(async () => {
        calls.push("activeDay");
      });
      mockProjects.findById.mockImplementation(async () => {
        calls.push("findById");
        return { id: tenantId, firstMessage: true, integrated: true };
      });
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler({
        ...deps,
        trackActiveDay,
      });
      const event = createEvent(tenantId);

      await subscriber(event, createContext(tenantId, createFoldState()));

      expect(trackActiveDay).toHaveBeenCalledWith({
        projectId: tenantId,
        occurredAt: event.occurredAt,
      });
      expect(calls).toEqual(["activeDay", "findById"]);
    });

    it("marks no active day for a seeded sample trace", async () => {
      const trackActiveDay = vi.fn(async () => undefined);
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler({
        ...deps,
        trackActiveDay,
      });

      await subscriber(
        createEvent(tenantId),
        createContext(tenantId, createFoldState({ attributes: { "langwatch.origin": "sample" } })),
      );

      expect(trackActiveDay).not.toHaveBeenCalled();
    });

    it("completes without error when no tracker is wired", async () => {
      const subscriber = ProjectMetadataSync.createProjectMetadataHandler(deps);

      await expect(
        subscriber(createEvent(tenantId), createContext(tenantId, createFoldState())),
      ).resolves.toBeUndefined();
    });
  });
});
