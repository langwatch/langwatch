import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_CODE_EVENT_SCOPE,
  CLAUDE_CODE_TRACING_SCOPE,
} from "~/server/app-layer/traces/claude-code-log-events";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createClaudeCodeEnhancedTelemetryGateReactor,
  type ClaudeCodeEnhancedTelemetryGateReactorDeps,
} from "../claudeCodeEnhancedTelemetryGate.reactor";

function createSpanReceivedEvent(
  tenantId: string,
  scopeName: string | null,
): TraceProcessingEvent {
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
      instrumentationScope: scopeName === null ? null : { name: scopeName },
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
}

function createLogRecordEvent(tenantId: string): TraceProcessingEvent {
  return {
    id: "event-log-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId,
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.log_record_received",
    version: 1,
    data: {
      traceId: "trace-1",
      spanId: "span-1",
      timeUnixMs: Date.now(),
      severityNumber: 0,
      severityText: "",
      body: "hi",
      attributes: {},
      resourceAttributes: {},
      scopeName: CLAUDE_CODE_TRACING_SCOPE,
      scopeVersion: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  } as unknown as TraceProcessingEvent;
}

const emptyContext = {} as ReactorContext;

function createMockProjectService() {
  return {
    getById: vi.fn(),
    getWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    isFeatureEnabled: vi.fn(),
    hasClaudeCodeEnhancedTelemetry: vi.fn(),
    enableClaudeCodeEnhancedTelemetry: vi.fn(),
    repo: {} as any,
  };
}

describe("createClaudeCodeEnhancedTelemetryGateReactor()", () => {
  let deps: ClaudeCodeEnhancedTelemetryGateReactorDeps;
  let mockProjects: ReturnType<typeof createMockProjectService>;
  const tenantId = "project-123";

  beforeEach(() => {
    mockProjects = createMockProjectService();
    deps = { projects: mockProjects as any };
  });

  describe("when a real Claude Code tracing span arrives", () => {
    beforeEach(() => {
      mockProjects.hasClaudeCodeEnhancedTelemetry.mockResolvedValue(false);
      mockProjects.enableClaudeCodeEnhancedTelemetry.mockResolvedValue(
        undefined,
      );
    });

    it("enables the project's enhanced-telemetry flag", async () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createSpanReceivedEvent(tenantId, CLAUDE_CODE_TRACING_SCOPE);

      await reactor.handle(event, emptyContext);

      expect(
        mockProjects.enableClaudeCodeEnhancedTelemetry,
      ).toHaveBeenCalledWith(tenantId);
    });

    it("reacts to the event", () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createSpanReceivedEvent(tenantId, CLAUDE_CODE_TRACING_SCOPE);

      expect(reactor.shouldReact!(event, emptyContext)).toBe(true);
    });
  });

  describe("when the flag is already set", () => {
    beforeEach(() => {
      mockProjects.hasClaudeCodeEnhancedTelemetry.mockResolvedValue(true);
    });

    it("does not write the flag again", async () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createSpanReceivedEvent(tenantId, CLAUDE_CODE_TRACING_SCOPE);

      await reactor.handle(event, emptyContext);

      expect(
        mockProjects.enableClaudeCodeEnhancedTelemetry,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when a span from another scope arrives", () => {
    it("does not react", () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createSpanReceivedEvent(tenantId, "some.other.scope");

      expect(reactor.shouldReact!(event, emptyContext)).toBe(false);
    });

    it("does not enable the flag even if handled directly", async () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createSpanReceivedEvent(tenantId, "some.other.scope");

      await reactor.handle(event, emptyContext);

      expect(
        mockProjects.hasClaudeCodeEnhancedTelemetry,
      ).not.toHaveBeenCalled();
      expect(
        mockProjects.enableClaudeCodeEnhancedTelemetry,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when the claude_code LOG scope arrives as a span", () => {
    it("does not react (the log scope is not the tracing scope)", () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createSpanReceivedEvent(tenantId, CLAUDE_CODE_EVENT_SCOPE);

      expect(reactor.shouldReact!(event, emptyContext)).toBe(false);
    });
  });

  describe("when a non-span event arrives", () => {
    it("does not react", () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createLogRecordEvent(tenantId);

      expect(reactor.shouldReact!(event, emptyContext)).toBe(false);
    });

    it("does not enable the flag even if handled directly", async () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createLogRecordEvent(tenantId);

      await reactor.handle(event, emptyContext);

      expect(
        mockProjects.enableClaudeCodeEnhancedTelemetry,
      ).not.toHaveBeenCalled();
    });
  });

  describe("when enabling the flag throws", () => {
    beforeEach(() => {
      mockProjects.hasClaudeCodeEnhancedTelemetry.mockResolvedValue(false);
      mockProjects.enableClaudeCodeEnhancedTelemetry.mockRejectedValue(
        new Error("database error"),
      );
    });

    it("swallows the error (non-fatal)", async () => {
      const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
      const event = createSpanReceivedEvent(tenantId, CLAUDE_CODE_TRACING_SCOPE);

      await expect(reactor.handle(event, emptyContext)).resolves.toBeUndefined();
    });
  });

  it("uses dedup makeJobId based on tenantId", () => {
    const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);
    const event = createSpanReceivedEvent(tenantId, CLAUDE_CODE_TRACING_SCOPE);

    const jobId = reactor.options!.makeJobId!({
      event: event as any,
      foldState: {} as any,
    });

    expect(jobId).toBe(`cc-enhanced:${tenantId}`);
  });

  it("runs only in worker", () => {
    const reactor = createClaudeCodeEnhancedTelemetryGateReactor(deps);

    expect(reactor.options!.runIn).toEqual(["worker"]);
  });
});
