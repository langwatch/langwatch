/**
 * @vitest-environment node
 *
 * Integration tests for HTTP agent test tracing.
 * Tests that httpProxy.execute creates traces when agentId is provided,
 * capturing request/response details with sanitized auth credentials.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Field } from "~/optimization_studio/types/dsl";
import type { StudioClientEvent } from "~/optimization_studio/types/events";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// The request itself is the workflow engine's now, so the engine is what these
// tests stand in for. What is being tested is the trace the app writes around
// it.
const mockPostEvent = vi.fn();
vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent: (args: unknown) => mockPostEvent(args),
}));

vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: (event: unknown) => Promise.resolve(event),
}));

// Mock getApp().traces.recordSpan to capture the OTLP span the route records.
// Mock both path forms used across the codebase — relative (matches the
// httpProxyTracing.ts import) and tsconfig-alias. vi.mock is hoisted so the
// shared mock fn lives in vi.hoisted() to be visible to both factories.
const { mockScheduleTrace } = vi.hoisted(() => ({
  mockScheduleTrace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: {
      recordSpan: (...args: unknown[]) => mockScheduleTrace(...args),
    },
  }),
}));
vi.mock("../../../app-layer/app", () => ({
  getApp: () => ({
    traces: {
      recordSpan: (...args: unknown[]) => mockScheduleTrace(...args),
    },
  }),
}));

type OtlpAttr = {
  key: string;
  value: { stringValue?: string; doubleValue?: number; boolValue?: boolean };
};
type OtlpSpan = {
  traceId: string;
  attributes: OtlpAttr[];
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: { code: number; message?: string };
};
type RecordSpanArgs = {
  tenantId: string;
  span: OtlpSpan;
  resource: { attributes: OtlpAttr[] } | null;
};

function recordSpanArgs(): RecordSpanArgs {
  return mockScheduleTrace.mock.calls[0]![0] as RecordSpanArgs;
}

function findAttr(
  attrs: OtlpAttr[] | undefined,
  key: string,
): OtlpAttr["value"] | undefined {
  return attrs?.find((a) => a.key === key)?.value;
}

function resourceAttr(key: string): string | undefined {
  return findAttr(recordSpanArgs().resource?.attributes, key)?.stringValue;
}

type CollectorJobFacade = {
  projectId: string;
  traceId: string;
  spans: Array<{
    input: { value: unknown };
    output: { value: unknown };
    error: { has_error: boolean; message: string } | null;
    timestamps: { started_at: number; finished_at: number };
  }>;
  reservedTraceMetadata: { user_id?: string };
  customMetadata: Record<string, unknown>;
};

function getTraceJob(): CollectorJobFacade {
  const args = recordSpanArgs();
  const span = args.span;
  const inputJson = findAttr(span.attributes, "langwatch.input")?.stringValue;
  const outputJson = findAttr(span.attributes, "langwatch.output")?.stringValue;
  const hasError =
    findAttr(span.attributes, "error.has_error")?.boolValue ?? false;
  const errorMessage =
    findAttr(span.attributes, "error.message")?.stringValue ?? "";
  return {
    projectId: args.tenantId,
    traceId: span.traceId,
    spans: [
      {
        input: { value: inputJson ? JSON.parse(inputJson).value : undefined },
        output: {
          value: outputJson ? JSON.parse(outputJson).value : undefined,
        },
        error: hasError ? { has_error: true, message: errorMessage } : null,
        timestamps: {
          started_at: Math.floor(Number(span.startTimeUnixNano) / 1_000_000),
          finished_at: Math.floor(Number(span.endTimeUnixNano) / 1_000_000),
        },
      },
    ],
    reservedTraceMetadata: { user_id: resourceAttr("langwatch.user.id") },
    customMetadata: {
      type: resourceAttr("langwatch.metadata.type"),
      agent_id: resourceAttr("langwatch.metadata.agent_id"),
    },
  };
}

function parseOutputValue(
  span: CollectorJobFacade["spans"][number],
): Record<string, unknown> {
  const value = span.output?.value;
  return (typeof value === "string" ? JSON.parse(value) : value) as Record<
    string,
    unknown
  >;
}

describe("HTTP Proxy Tracing", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;
  let userId: string;

  beforeAll(async () => {
    const user = await getTestUser();
    userId = user.id;
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /** Replies to the dispatch with the state the engine finished the node in. */
  function engineReplies(executionState: Record<string, unknown>) {
    mockPostEvent.mockImplementation(
      async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({
          type: "component_state_change",
          payload: {
            component_id: "http_agent_test",
            execution_state: executionState,
          },
        });
      },
    );
  }

  function mockSuccessResponse(
    body: Record<string, unknown> = { result: "success" },
  ) {
    engineReplies({
      status: "success",
      outputs: { output: body },
      timestamps: { started_at: 1_000, finished_at: 1_100 },
      http: {
        status_code: 200,
        status_text: "OK",
        response_headers: { "content-type": "application/json" },
        rendered_body: "{}",
      },
    });
  }

  /** The headers the router put on the node it dispatched. */
  function dispatchedHeaders(): Record<string, string> {
    const event = mockPostEvent.mock.calls[0]?.[0]
      ?.message as StudioClientEvent;
    if (event?.type !== "execute_component") throw new Error("no dispatch");
    const node = event.payload.workflow.nodes.find(
      (candidate) => candidate.id === event.payload.node_id,
    );
    const headers = node?.data.parameters?.find(
      (parameter: Field) => parameter.identifier === "headers",
    )?.value;
    return (headers ?? {}) as Record<string, string>;
  }

  describe("when agentId is provided", () => {
    /** @scenario Trace includes agent_test type */
    /** @scenario Test execution creates a trace visible on the Traces page */
    it("creates a trace with type agent_test", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(mockScheduleTrace).toHaveBeenCalledOnce();
      expect(getTraceJob().customMetadata.type).toBe("agent_test");
    });

    /** @scenario Trace includes agent ID */
    it("includes agent ID in trace metadata", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(getTraceJob().customMetadata.agent_id).toBe("agent-123");
    });

    /** @scenario Trace includes project ID */
    it("includes project ID in trace", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(getTraceJob().projectId).toBe(projectId);
    });

    /** @scenario Trace includes user ID */
    it("includes user ID in trace metadata", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(getTraceJob().reservedTraceMetadata.user_id).toBe(userId);
    });

    /** @scenario Trace captures response status code */
    it("captures response status code", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      const output = parseOutputValue(getTraceJob().spans[0]!);
      expect(output.status).toBe(200);
    });

    /** @scenario Trace captures response duration */
    it("captures request duration", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      const span = getTraceJob().spans[0]!;
      const duration = span.timestamps.finished_at - span.timestamps.started_at;
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    /** @scenario Trace captures response body */
    it("captures response body", async () => {
      const responseBody = { data: "test-value" };
      mockSuccessResponse(responseBody);

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      const output = parseOutputValue(getTraceJob().spans[0]!);
      expect(output.body).toEqual(responseBody);
    });

    /** @scenario Trace captures extracted output */
    it("captures extracted output when output path configured", async () => {
      engineReplies({
        status: "success",
        outputs: { output: "extracted text" },
        http: { status_code: 200 },
      });

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
        outputPath: "$.data.nested.value",
      });

      const output = parseOutputValue(getTraceJob().spans[0]!);
      expect(output.extracted_output).toBe("extracted text");
    });

    it("sends traceparent header in outgoing request", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(dispatchedHeaders().traceparent).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
      );
    });

    it("uses same trace ID in traceparent header and submitted trace", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      const traceIdFromHeader = dispatchedHeaders().traceparent!.split("-")[1];
      expect(getTraceJob().traceId).toBe(traceIdFromHeader);
    });
  });

  describe("when endpoint returns an error", () => {
    /** @scenario Trace captures HTTP error responses */
    it("captures the error response in the trace", async () => {
      engineReplies({
        status: "error",
        error: "httpblock: upstream returned 404",
        error_type: "upstream_http_error",
        upstream_status: 404,
        http: { status_code: 404, status_text: "Not Found" },
      });

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      const span = getTraceJob().spans[0]!;
      expect(span.error).toBeTruthy();
      expect(span.error?.has_error).toBe(true);
    });
  });

  describe("when endpoint is unreachable", () => {
    /** @scenario Trace captures connection failures */
    it("captures the connection error in the trace", async () => {
      engineReplies({
        status: "error",
        error: "httpblock: dial tcp 10.0.0.9:80: ECONNREFUSED",
        error_type: "http_error",
      });

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(mockScheduleTrace).toHaveBeenCalledOnce();
      const errorMessage = getTraceJob().spans[0]!.error?.message ?? "";
      expect(errorMessage.includes("ECONNREFUSED")).toBe(true);
    });
  });

  describe("when the engine cannot be reached", () => {
    it("creates a trace with the dispatch failure", async () => {
      mockPostEvent.mockRejectedValue(new Error("engine unreachable"));

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(mockScheduleTrace).toHaveBeenCalledOnce();
      const span = getTraceJob().spans[0]!;
      expect(span.error?.has_error).toBe(true);
      expect(span.error?.message).toBe("engine unreachable");
    });
  });

  describe("when bearer auth is used", () => {
    /** @scenario Bearer token credentials are redacted from trace */
    /** @scenario Authorization headers are redacted in captured request headers */
    it("redacts the bearer token from the trace", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        auth: { type: "bearer", token: "super-secret-token" },
        bodyTemplate: "{}",
      });

      const inputValue = getTraceJob().spans[0]!.input?.value as Record<
        string,
        unknown
      >;
      const headers = inputValue.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer [REDACTED]");
    });
  });

  describe("when api_key auth is used", () => {
    /** @scenario API key credentials are redacted from trace */
    /** @scenario Custom auth headers are redacted in captured request headers */
    it("redacts the API key value from the trace", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        auth: {
          type: "api_key",
          header: "X-API-Key",
          value: "secret-api-key-value",
        },
        bodyTemplate: "{}",
      });

      const inputValue = getTraceJob().spans[0]!.input?.value as Record<
        string,
        unknown
      >;
      const headers = inputValue.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("[REDACTED]");
    });
  });

  describe("when basic auth is used", () => {
    /** @scenario Basic auth credentials are redacted from trace */
    it("redacts the username and password from the trace", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        auth: {
          type: "basic",
          username: "admin-user",
          password: "super-password",
        },
        bodyTemplate: "{}",
      });

      const inputValue = getTraceJob().spans[0]!.input?.value as Record<
        string,
        unknown
      >;
      const headers = inputValue.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Basic [REDACTED]");
    });
  });

  describe("when agentId is not provided", () => {
    it("does not create a trace", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(mockScheduleTrace).not.toHaveBeenCalled();
    });

    it("does not send traceparent header", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        bodyTemplate: "{}",
      });

      expect(dispatchedHeaders().traceparent).toBeUndefined();
    });
  });
});
