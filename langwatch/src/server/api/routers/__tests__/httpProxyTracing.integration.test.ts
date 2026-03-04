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

// Mock scheduleTraceCollectionWithFallback to capture trace data
const mockScheduleTrace = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/background/workers/collectorWorker", () => ({
  scheduleTraceCollectionWithFallback: (...args: unknown[]) =>
    mockScheduleTrace(...args),
}));

type CollectorJob = {
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

function getTraceJob(): CollectorJob {
  return mockScheduleTrace.mock.calls[0]![0] as CollectorJob;
}

function parseOutputValue(span: CollectorJob["spans"][number]): Record<string, unknown> {
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
