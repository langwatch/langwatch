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

/** Trace's milestone commands; the subscriber never reaches a product-analytics client itself. */
const mockRecordSignal = vi.fn(async () => undefined);

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
  createProjectMetadataHandler,
  isRealFirstIngest,
} from "../project-metadata.subscriber.ts";
import { milestonesOver } from "./project-milestones.test-helpers.ts";

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

describe("createProjectMetadataHandler()", () => {
  let deps: ProjectMetadataSubscriberDeps;
  let mockProjects: ReturnType<typeof createMockProjectService>;
  const tenantId = "project-123";

  beforeEach(() => {
    logger.error.mockClear();
    logger.warn.mockClear();
    mockRecordSignal.mockClear();
    mockProjects = createMockProjectService();
    deps = {
      projects: mockProjects as any,
      milestones: milestonesOver(mockRecordSignal),
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
      const subscriber = createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ firstMessage: true }),
      });
    });

    it("sets integrated to true for non-optimization-studio traces", async () => {
      const subscriber = createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ integrated: true }),
      });
    });

    /** @scenario The project metadata subscriber names three capabilities, not a service */
    it("runs over a project read, a metadata write and an org-admin lookup alone", async () => {
      const subscriber = createProjectMetadataHandler({
        projects: {
          findById: (id) => mockProjects.findById(id),
          updateMetadata: (input) => mockProjects.updateMetadata(input),
          resolveOrgAdmin: (id) => mockProjects.resolveOrgAdmin(id),
        },
        milestones: milestonesOver(mockRecordSignal),
      });

      await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ firstMessage: true }),
      });
    });

    /**
     * @scenario First trace tracks the PostHog integration milestone against the org admin
     * @scenario The milestone is attributed to the person the browser knows
     * @scenario The first-trace milestone is recorded through a sink, not a function
     * @scenario "A project's first trace claims its topic clustering"
     */
    it("tracks first_trace_integrated against the org admin", async () => {
      const subscriber = createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const state = createFoldState({
        attributes: {
          "sdk.language": "python",
          "langwatch.sdk.framework": "openai",
        },
      });

      await subscriber(event, createContext(tenantId, state));

      expect(mockRecordSignal).toHaveBeenCalledTimes(1);
      expect(mockRecordSignal).toHaveBeenCalledWith({
        recorded: "firstTrace",
        tenantId,
        occurredAt: event.occurredAt,
        userId: "admin-user-1",
        projectId: tenantId,
        sdkLanguage: "python",
        sdkFramework: "openai",
      });
    });

    /** @scenario Recording never fails the trace that caused it */
    it("still writes the project when the nurturing signal is refused", async () => {
      mockRecordSignal.mockRejectedValueOnce(new Error("milestone pipeline unavailable"));
      const subscriber = createProjectMetadataHandler(deps);

      await expect(
        subscriber(createEvent(tenantId), createContext(tenantId, createFoldState())),
      ).resolves.toBeUndefined();

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ integrated: true }),
      });
    });

    /** @scenario "the first signal of the day tracks the project's active day" */
    it("passes the organization's creation time and onboarding variant to the first-trace record", async () => {
      mockProjects.resolveOrgAdmin.mockResolvedValue({
        userId: "admin-user-1",
        organizationId: "org-1",
        firstMessage: false,
        onboardingVariant: "guided",
        organizationCreatedAt: { epochMilliseconds: 1_700_000_000_000 },
      });
      const subscriber = createProjectMetadataHandler(deps);

      await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

      expect(mockRecordSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          recorded: "firstTrace",
          organizationCreatedAt: 1_700_000_000_000,
          onboardingVariant: "guided",
        }),
      );
    });

    /** @scenario PostHog integration milestone reports unknown when SDK attributes are absent */
    it("falls back to unknown sdk properties when attributes are absent", async () => {
      const subscriber = createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);

      await subscriber(event, createContext(tenantId, createFoldState()));

      expect(mockRecordSignal).toHaveBeenCalledWith(
        expect.objectContaining({ sdkLanguage: "unknown", sdkFramework: "unknown" }),
      );
    });

    /** @scenario PostHog integration milestone is skipped when the project has no org admin */
    it("does not track first_trace_integrated when no admin user is found", async () => {
      mockProjects.resolveOrgAdmin.mockResolvedValue({
        userId: null,
        organizationId: null,
        firstMessage: false,
      });
      const subscriber = createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);

      await subscriber(event, createContext(tenantId, createFoldState()));

      expect(mockRecordSignal).not.toHaveBeenCalled();
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
      const subscriber = createProjectMetadataHandler(deps);
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
      const subscriber = createProjectMetadataHandler(deps);
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
      const subscriber = createProjectMetadataHandler(deps);
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
      const subscriber = createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);
    });

    it("does not update the project", async () => {
      expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
    });

    /** @scenario PostHog integration milestone fires only on the firstMessage transition */
    it("does not track first_trace_integrated again", async () => {
      expect(mockRecordSignal).toHaveBeenCalledTimes(1);
      expect(mockRecordSignal).not.toHaveBeenCalledWith(
        expect.objectContaining({ recorded: "firstTrace" }),
      );
    });

    /** @scenario "A later trace tells nurturing against the organization's admin" */
    it("tells nurturing a later trace against the org admin", async () => {
      expect(mockRecordSignal).toHaveBeenCalledWith({
        recorded: "traceReceived",
        tenantId,
        occurredAt: expect.any(Number),
        userId: "admin-user-1",
        projectId: tenantId,
      });
    });
  });

  describe("when a later trace resolves an org admin with a signup time and variant", () => {
    /** @scenario "the first signal of the day tracks the project's active day" */
    it("passes both to the trace-received record", async () => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: true,
      });
      mockProjects.resolveOrgAdmin.mockResolvedValue({
        userId: "admin-user-1",
        organizationId: "org-1",
        firstMessage: true,
        onboardingVariant: "classic",
        organizationCreatedAt: { epochMilliseconds: 1_700_000_000_000 },
      });
      const subscriber = createProjectMetadataHandler(deps);

      await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

      expect(mockRecordSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          recorded: "traceReceived",
          organizationCreatedAt: 1_700_000_000_000,
          onboardingVariant: "classic",
        }),
      );
    });
  });

  describe("when a later trace resolves no org admin", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: true,
      });
      mockProjects.resolveOrgAdmin.mockResolvedValue({
        userId: null,
        organizationId: null,
        firstMessage: true,
      });
    });

    /** @scenario "A later trace in a project with no organization admin tells nurturing nothing" */
    it("tells nurturing nothing", async () => {
      const subscriber = createProjectMetadataHandler(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await subscriber(event, context);

      expect(mockRecordSignal).not.toHaveBeenCalled();
    });
  });

  describe("when project is not found", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue(null);
    });

    it("does not update the project", async () => {
      const subscriber = createProjectMetadataHandler(deps);
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
      const subscriber = createProjectMetadataHandler(deps);
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
    let subscriber: ReturnType<typeof createProjectMetadataHandler>;
    let event: TraceProcessingEvent;
    let context: TriggerContext<TraceSummaryData>;

    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockRejectedValue(new Error("database error"));
      subscriber = createProjectMetadataHandler(deps);
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

      expect(mockRecordSignal).not.toHaveBeenCalled();
    });
  });

  describe("given a project receiving its first real trace", () => {
    beforeEach(() => {
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
      deps = {
        projects: mockProjects as any,
        milestones: milestonesOver(mockRecordSignal),
      };
    });

    describe("when the trace arrives", () => {
      it("records the first trace as trace's own milestone, which topic reacts to", async () => {
        const subscriber = createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
        expect(mockRecordSignal).toHaveBeenCalledWith(
          expect.objectContaining({ recorded: "firstTrace", projectId: tenantId }),
        );
      });
    });

    describe("when the project is already marked as integrated", () => {
      it("records a later trace and writes no metadata", async () => {
        mockProjects.findById.mockResolvedValue({
          id: tenantId,
          firstMessage: true,
          integrated: true,
        });
        const subscriber = createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(mockRecordSignal).toHaveBeenCalledWith(
          expect.objectContaining({ recorded: "traceReceived", projectId: tenantId }),
        );
        expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a project that already received its first message", () => {
    beforeEach(() => {
      // Not yet integrated, so the subscriber still writes metadata.
      mockProjects.findById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
      deps = {
        projects: mockProjects as any,
        milestones: milestonesOver(mockRecordSignal),
      };
    });

    describe("when another trace arrives", () => {
      beforeEach(async () => {
        const subscriber = createProjectMetadataHandler(deps);

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));
      });

      it("updates the metadata", async () => {
        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
      });

      it("does not track first_trace_integrated for the repeat write", async () => {
        // The event is gated on the firstMessage transition, not on the
        // metadata write: an integrated-flag repair must not re-fire it.
        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
        expect(mockRecordSignal).not.toHaveBeenCalledWith(
          expect.objectContaining({ recorded: "firstTrace" }),
        );
      });

      it("tells nurturing a later trace, since firstMessage was already set", async () => {
        expect(mockRecordSignal).toHaveBeenCalledWith(
          expect.objectContaining({ recorded: "traceReceived" }),
        );
      });
    });
  });

  describe("given the project no longer exists", () => {
    describe("when a trace arrives", () => {
      it("records no milestone", async () => {
        mockProjects.findById.mockResolvedValue(null);
        const subscriber = createProjectMetadataHandler({
          projects: mockProjects as any,
          milestones: milestonesOver(mockRecordSignal),
        });

        await subscriber(createEvent(tenantId), createContext(tenantId, createFoldState()));

        expect(mockRecordSignal).not.toHaveBeenCalled();
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

        expect(isRealFirstIngest(state)).toBe(true);
      });
    });

    describe("when the trace is a seeded sample", () => {
      it("returns false", () => {
        const state = createFoldState({
          attributes: { "langwatch.origin": "sample" },
        });

        expect(isRealFirstIngest(state)).toBe(false);
      });
    });

    describe("when the trace is one of Langy's own turns", () => {
      it("returns false", () => {
        const state = createFoldState({
          attributes: { "langwatch.origin": "langy" },
        });

        expect(isRealFirstIngest(state)).toBe(false);
      });

      /** @scenario Langy's own turn is not the project's first trace */
      it("leaves the project unmarked and tells nurturing nothing", async () => {
        mockProjects.findById.mockResolvedValue({
          id: tenantId,
          firstMessage: false,
          integrated: false,
        });
        const subscriber = createProjectMetadataHandler(deps);
        const state = createFoldState({ attributes: { "langwatch.origin": "langy" } });

        await subscriber(createEvent(tenantId), createContext(tenantId, state));

        expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
        expect(mockRecordSignal).not.toHaveBeenCalled();
      });
    });
  });
});
