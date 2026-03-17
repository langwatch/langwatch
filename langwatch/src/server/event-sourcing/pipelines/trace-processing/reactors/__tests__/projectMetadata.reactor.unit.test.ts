import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("createProjectMetadataReactor()", () => {
  let deps: ProjectMetadataReactorDeps;
  const tenantId = "project-123";

  beforeEach(() => {
    deps = {
      prisma: {
        project: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      } as any,
    };
  });

  describe("when project has not received first message", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      } as any);
      vi.mocked(deps.prisma.project.update).mockResolvedValue({} as any);
    });

    it("sets firstMessage to true", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: tenantId },
          data: expect.objectContaining({ firstMessage: true }),
        }),
      );
    });

    it("sets integrated to true for non-optimization-studio traces", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ integrated: true }),
        }),
      );
    });
  });

  describe("when sdk.language is python", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      } as any);
      vi.mocked(deps.prisma.project.update).mockResolvedValue({} as any);
    });

    it("detects language as python from foldState attributes", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "sdk.language": "python" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ language: "python" }),
        }),
      );
    });
  });

  describe("when sdk.language is typescript", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      } as any);
      vi.mocked(deps.prisma.project.update).mockResolvedValue({} as any);
    });

    it("detects language as typescript from foldState attributes", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "sdk.language": "typescript" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ language: "typescript" }),
        }),
      );
    });
  });

  describe("when sdk.language is not recognized", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      } as any);
      vi.mocked(deps.prisma.project.update).mockResolvedValue({} as any);
    });

    it("falls back to 'other'", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "sdk.language": "java" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ language: "other" }),
        }),
      );
    });
  });

  describe("when project is already fully integrated", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue({
        id: tenantId,
        firstMessage: true,
        integrated: true,
      } as any);
    });

    it("does not update the project", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).not.toHaveBeenCalled();
    });
  });

  describe("when project is not found", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue(null);
    });

    it("does not update the project", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const context = createContext(tenantId, createFoldState());

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).not.toHaveBeenCalled();
    });
  });

  describe("when platform is optimization_studio", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      } as any);
      vi.mocked(deps.prisma.project.update).mockResolvedValue({} as any);
    });

    it("does not set integrated to true", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "langwatch.platform": "optimization_studio" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ integrated: false }),
        }),
      );
    });

    it("sets language to 'other'", async () => {
      const reactor = createProjectMetadataReactor(deps);
      const event = createEvent(tenantId);
      const foldState = createFoldState({
        attributes: { "langwatch.platform": "optimization_studio" },
      });
      const context = createContext(tenantId, foldState);

      await reactor.handle(event, context);

      expect(deps.prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ language: "other" }),
        }),
      );
    });
  });

  describe("when Prisma update throws", () => {
    beforeEach(() => {
      vi.mocked(deps.prisma.project.findUnique).mockResolvedValue({
        id: tenantId,
        firstMessage: false,
        integrated: false,
      } as any);
      vi.mocked(deps.prisma.project.update).mockRejectedValue(
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
});
