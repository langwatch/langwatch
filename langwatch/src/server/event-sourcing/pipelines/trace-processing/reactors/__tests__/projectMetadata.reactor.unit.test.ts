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

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createProjectMetadataReactor,
  type ProjectMetadataReactorDeps,
} from "../projectMetadata.reactor";


function createFoldState(
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
  };
}

function createEvent(tenantId: string): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId,
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
}

function createContext(
  tenantId: string,
  foldState: TraceSummaryData,
): ReactorContext<TraceSummaryData> {
  return {
    tenantId,
    aggregateId: "trace-1",
    foldState,
  };
}

function createMockProjectService() {
  return {
    getById: vi.fn(),
    getWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    isFeatureEnabled: vi.fn(),
    repo: {} as any,
  };
}

describe("createProjectMetadataReactor()", () => {
  let deps: ProjectMetadataReactorDeps;
  let mockProjects: ReturnType<typeof createMockProjectService>;
  const tenantId = "project-123";

  beforeEach(() => {
    logger.error.mockClear();
    logger.warn.mockClear();
    mockProjects = createMockProjectService();
    deps = {
      projects: mockProjects as any,
    };
  });

  describe("when project has not received first message", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    /** @scenario "Project marks as integrated after first trace ingestion" */
    it("sets firstMessage to true", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ firstMessage: true }),
      });
    });

    it("sets integrated to true for non-optimization-studio traces", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ integrated: true }),
      });
    });
  });

  describe("when sdk.language is python", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    it("detects language as python from foldState attributes", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "sdk.language": "python" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "python" }),
      });
    });
  });

  describe("when sdk.language is typescript", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    it("detects language as typescript from foldState attributes", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "sdk.language": "typescript" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "typescript" }),
      });
    });
  });

  describe("when sdk.language is not recognized", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    it("falls back to 'other'", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "sdk.language": "java" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "other" }),
      });
    });
  });

  describe("when project is already fully integrated", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: true,
      });
    });

    it("does not update the project", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when project is not found", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue(null);
    });

    it("does not update the project", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when platform is optimization_studio", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
    });

    it("does not set integrated to true", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "langwatch.platform": "optimization_studio" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ integrated: false }),
      });
    });

    it("sets language to 'other'", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "langwatch.platform": "optimization_studio" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(mockProjects.updateMetadata).toHaveBeenCalledWith({
        id: tenantId,
        data: expect.objectContaining({ language: "other" }),
      });
    });
  });

  describe("when updateMetadata throws", () => {
    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockRejectedValue(
        new Error("database error"),
      );
    });

    it("swallows the error (non-fatal)", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      // Must not throw
      await expect(reactor.handle(event, context)).resolves.toBeUndefined();
    });


  });

  describe("given a project receiving its first real trace", () => {
    let bootstrapTopicClustering: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
      bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
      deps = {
        projects: mockProjects as any,
        bootstrapTopicClustering: bootstrapTopicClustering as any,
      };
    });

    describe("when a topic clustering bootstrap is wired", () => {
      it("bootstraps the project's clustering schedule exactly once", async () => {
        const reactor = createProjectMetadataReactor(deps);

        await reactor.handle(
          createEvent(tenantId),
          createContext(tenantId, createFoldState()),
        );

        expect(bootstrapTopicClustering).toHaveBeenCalledTimes(1);
        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
      });

      it("bootstraps independently of the metadata write", async () => {
        // The bootstrap is no longer sequenced behind the metadata write: it
        // has to run for projects whose metadata needs no update at all. Its
        // own try/catch, not its position, is what keeps a bootstrap failure
        // from being reported as a metadata failure.
        mockProjects.updateMetadata.mockRejectedValue(new Error("pg down"));
        const reactor = createProjectMetadataReactor(deps);

        await reactor.handle(
          createEvent(tenantId),
          createContext(tenantId, createFoldState()),
        );

        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
      });
    });

    describe("when the project is already marked as integrated", () => {
      it("still re-asserts the clustering schedule", async () => {
        // The regression that made a deploy-time backfill necessary: an
        // established project returned early, so a project that lost its
        // schedule never got it back from ingest. Bootstrap is level-triggered
        // now, so every real trace re-asserts it.
        mockProjects.getById.mockResolvedValue({
          id: tenantId,
          firstMessage: true,
          integrated: true,
        });
        const reactor = createProjectMetadataReactor(deps);

        await reactor.handle(
          createEvent(tenantId),
          createContext(tenantId, createFoldState()),
        );

        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
        // Still no redundant metadata write for an already-marked project.
        expect(mockProjects.updateMetadata).not.toHaveBeenCalled();
      });
    });

    describe("when the bootstrap throws", () => {
      beforeEach(() => {
        bootstrapTopicClustering.mockRejectedValue(
          new Error("process store unavailable"),
        );
      });

      it("swallows the failure (non-fatal)", async () => {
        const reactor = createProjectMetadataReactor(deps);

        await expect(
          reactor.handle(
            createEvent(tenantId),
            createContext(tenantId, createFoldState()),
          ),
        ).resolves.toBeUndefined();
      });

      it("does not report the committed metadata write as failed", async () => {
        const reactor = createProjectMetadataReactor(deps);

        await reactor.handle(
          createEvent(tenantId),
          createContext(tenantId, createFoldState()),
        );

        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
        const [, message] = logger.error.mock.calls[0]!;
        expect(message).toMatch(/bootstrap failed/i);
        expect(message).not.toMatch(/Failed to update project metadata/i);
      });
    });

    describe("when no bootstrap is wired", () => {
      it("completes the metadata write without error", async () => {
        const reactor = createProjectMetadataReactor({
          projects: mockProjects as any,
        });

        await expect(
          reactor.handle(
            createEvent(tenantId),
            createContext(tenantId, createFoldState()),
          ),
        ).resolves.toBeUndefined();

        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a project that already received its first message", () => {
    let bootstrapTopicClustering: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Not yet integrated, so the reactor still writes metadata. The
      // bootstrap is no longer gated on the first-message transition.
      mockProjects.getById.mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: false,
      });
      mockProjects.updateMetadata.mockResolvedValue(undefined);
      bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
      deps = {
        projects: mockProjects as any,
        bootstrapTopicClustering: bootstrapTopicClustering as any,
      };
    });

    describe("when another trace arrives", () => {
      it("updates the metadata and re-asserts the clustering schedule", async () => {
        // Re-asserting is the point: it is idempotent at the process (a
        // bootstrap-trigger request cannot move the wake or start a run) and
        // rate-limited at the injected implementation, so the reconciliation
        // costs at most one commit per project per claim window.
        const reactor = createProjectMetadataReactor(deps);

        await reactor.handle(
          createEvent(tenantId),
          createContext(tenantId, createFoldState()),
        );

        expect(mockProjects.updateMetadata).toHaveBeenCalledTimes(1);
        expect(bootstrapTopicClustering).toHaveBeenCalledWith(tenantId);
      });
    });
  });

  describe("given the project no longer exists", () => {
    describe("when a trace arrives", () => {
      it("does not bootstrap clustering", async () => {
        const bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
        mockProjects.getById.mockResolvedValue(null);
        const reactor = createProjectMetadataReactor({
          projects: mockProjects as any,
          bootstrapTopicClustering: bootstrapTopicClustering as any,
        });

        await reactor.handle(
          createEvent(tenantId),
          createContext(tenantId, createFoldState()),
        );

        expect(bootstrapTopicClustering).not.toHaveBeenCalled();
      });
    });
  });

  it("uses dedup makeJobId based on tenantId", () => {
    const reactor = createProjectMetadataReactor(deps);
    const event = createEvent(tenantId);

    const jobId = reactor.options!.makeJobId!({
      event: event as any,
      foldState: {} as any,
    });

    expect(jobId).toBe(`project-meta:${tenantId}`);
  });

  it("has a 60-second dedup TTL", () => {
    const reactor = createProjectMetadataReactor(deps);

    expect(reactor.options!.ttl).toBe(60_000);
  });

  it("runs only in worker", () => {
    const reactor = createProjectMetadataReactor(deps);

    expect(reactor.options!.runIn).toEqual(["worker"]);
  });

  describe("when deciding whether to react", () => {
    describe("when the trace is a real ingest", () => {
      it("returns true", () => {
        const reactor = createProjectMetadataReactor(deps);
        const foldState = createFoldState({
          attributes: { "langwatch.origin": "application" },
        });

        expect(
          reactor.shouldReact!(
            createEvent("tenant-1"),
            createContext("tenant-1", foldState),
          ),
        ).toBe(true);
      });
    });

    describe("when the trace is a seeded sample", () => {
      it("returns false", () => {
        const reactor = createProjectMetadataReactor(deps);
        const foldState = createFoldState({
          attributes: { "langwatch.origin": "sample" },
        });

        expect(
          reactor.shouldReact!(
            createEvent("tenant-1"),
            createContext("tenant-1", foldState),
          ),
        ).toBe(false);
      });
    });
  });
});
