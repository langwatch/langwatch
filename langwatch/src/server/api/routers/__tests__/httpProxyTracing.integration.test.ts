/**
 * @vitest-environment node
 *
 * Integration tests for HTTP agent test tracing.
 * Tests that httpProxy.execute creates traces when agentId is provided,
 * capturing request/response details with sanitized auth credentials.
 */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// Mock ssrfSafeFetch to bypass SSRF validation in tests
const mockSsrfSafeFetch = vi.fn();
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

// Mock getApp().traces.recordSpan to capture the OTLP span the route records.
const mockScheduleTrace = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: {
      recordSpan: (...args: unknown[]) => mockScheduleTrace(...args),
    },
  }),
}));

type OtlpAttr = { key: string; value: { stringValue?: string; doubleValue?: number; boolValue?: boolean } };
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

function findAttr(attrs: OtlpAttr[] | undefined, key: string): OtlpAttr["value"] | undefined {
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
  const hasError = findAttr(span.attributes, "error.has_error")?.boolValue ?? false;
  const errorMessage = findAttr(span.attributes, "error.message")?.stringValue ?? "";
  return {
    projectId: args.tenantId,
    traceId: span.traceId,
    spans: [
      {
        input: { value: inputJson ? JSON.parse(inputJson).value : undefined },
        output: { value: outputJson ? JSON.parse(outputJson).value : undefined },
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

function parseOutputValue(span: CollectorJobFacade["spans"][number]): Record<string, unknown> {
  const value = span.output?.value;
  return (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
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

  function mockSuccessResponse(body: Record<string, unknown> = { result: "success" }) {
    mockSsrfSafeFetch.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
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
        body: "{}",
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
        body: "{}",
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
        body: "{}",
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
        body: "{}",
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
        body: "{}",
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
        body: "{}",
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
        body: "{}",
      });

      const output = parseOutputValue(getTraceJob().spans[0]!);
      expect(output.body).toEqual(responseBody);
    });

    /** @scenario Trace captures extracted output */
    it("captures extracted output when output path configured", async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ data: { nested: { value: "extracted text" } } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
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
        body: "{}",
      });

      const [, fetchOptions] = mockSsrfSafeFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];
      const headers = fetchOptions.headers as Record<string, string>;
      expect(headers.traceparent).toMatch(
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
        body: "{}",
      });

      const [, fetchOptions] = mockSsrfSafeFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];
      const traceparent = (fetchOptions.headers as Record<string, string>).traceparent!;
      const traceIdFromHeader = traceparent.split("-")[1];
      expect(getTraceJob().traceId).toBe(traceIdFromHeader);
    });
  });

  describe("when endpoint returns an error", () => {
    /** @scenario Trace captures HTTP error responses */
    it("captures the error response in the trace", async () => {
      mockSsrfSafeFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        }),
      );

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
      });

      const span = getTraceJob().spans[0]!;
      expect(span.error).toBeTruthy();
      expect(span.error?.has_error).toBe(true);
    });
  });

  describe("when endpoint is unreachable", () => {
    /** @scenario Trace captures connection failures */
    it("captures the connection error in the trace", async () => {
      mockSsrfSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
      });

      expect(mockScheduleTrace).toHaveBeenCalledOnce();
      const errorMessage = getTraceJob().spans[0]!.error?.message ?? "";
      expect(errorMessage.includes("ECONNREFUSED")).toBe(true);
    });
  });

  describe("when request body is invalid JSON", () => {
    it("creates a trace with the parse error", async () => {
      await caller.httpProxy.execute({
        projectId,
        agentId: "agent-123",
        url: "https://api.example.com/test",
        method: "POST",
        body: "{invalid json",
      });

      expect(mockScheduleTrace).toHaveBeenCalledOnce();
      const span = getTraceJob().spans[0]!;
      expect(span.error?.has_error).toBe(true);
      expect(span.error?.message).toBe("Invalid JSON in request body");
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
        body: "{}",
      });

      const inputValue = getTraceJob().spans[0]!.input?.value as Record<string, unknown>;
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
          headerName: "X-API-Key",
          apiKeyValue: "secret-api-key-value",
        },
        body: "{}",
      });

      const inputValue = getTraceJob().spans[0]!.input?.value as Record<string, unknown>;
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
        body: "{}",
      });

      const inputValue = getTraceJob().spans[0]!.input?.value as Record<string, unknown>;
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
        body: "{}",
      });

      expect(mockScheduleTrace).not.toHaveBeenCalled();
    });

    it("does not send traceparent header", async () => {
      mockSuccessResponse();

      await caller.httpProxy.execute({
        projectId,
        url: "https://api.example.com/test",
        method: "POST",
        body: "{}",
      });

      const [, fetchOptions] = mockSsrfSafeFetch.mock.calls[0] as [
        string,
        RequestInit,
      ];
      const headers = fetchOptions.headers as Record<string, string>;
      expect(headers.traceparent).toBeUndefined();
    });
  });
});
