/**
 * @vitest-environment node
 *
 * What one HTTP agent test records. The builder decides the span's contents;
 * the gate that decides whether anything is recorded at all lives in the
 * transport and is covered by `http-proxy-trace-gate.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  buildAgentTestTrace,
  buildTraceTestContext,
  buildTraceparentHeader,
  generateTraceIds,
} from "../agent-test-tracing";

const NOW = 1_800_000_000_000;

function traceFor(
  result: Parameters<typeof buildAgentTestTrace>[0]["result"],
  overrides: Partial<Parameters<typeof buildAgentTestTrace>[0]> = {},
) {
  return buildAgentTestTrace({
    agentId: "agent_1",
    userId: "user_1",
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    testContext: buildTraceTestContext({
      url: "https://agent.test/answer",
      method: "POST",
      auth: { type: "bearer", token: "secret" },
      ...(overrides.testContext ? {} : {}),
    }),
    requestBody: '{"question":"hi"}',
    requestHeaders: { Authorization: "Bearer redacted" },
    result,
    now: NOW,
    ...overrides,
  });
}

describe("buildAgentTestTrace()", () => {
  describe("given a test request that the endpoint answered", () => {
    describe("when the trace for it is built", () => {
      /** @scenario "Successful request creates a trace" */
      it("names the agent and the user, and carries the status, duration and body", () => {
        const trace = traceFor({
          success: true,
          status: 200,
          statusText: "OK",
          duration: 250,
          response: { answer: "hello" },
        });

        expect(trace.customMetadata).toMatchObject({
          type: "agent_test",
          agent_id: "agent_1",
        });
        expect(trace.userId).toBe("user_1");
        expect(trace.span.output).toEqual({
          type: "json",
          value: { status: 200, body: { answer: "hello" } },
        });
        expect(trace.span.timestamps).toEqual({
          started_at: NOW - 250,
          finished_at: NOW,
        });
        expect(trace.span.error).toBeNull();
        expect(trace.span.trace_id).toBe(trace.traceId);
        expect(trace.occurredAt).toBe(NOW);
      });
    });
  });

  describe("given an endpoint that answered 404", () => {
    describe("when the trace for it is built", () => {
      /** @scenario "Failed request creates a trace" */
      it("carries the error details and raises the span's error flag", () => {
        const trace = traceFor({
          success: false,
          status: 404,
          statusText: "Not Found",
          duration: 12,
          error: "Request failed with status 404",
        });

        expect(trace.span.error).toEqual({
          has_error: true,
          message: "Request failed with status 404",
          stacktrace: [],
        });
        expect(trace.span.output).toEqual({
          type: "json",
          value: { status: 404, error: "Request failed with status 404" },
        });
      });
    });
  });

  describe("given an endpoint that could not be reached at all", () => {
    describe("when the trace for it is built", () => {
      /** @scenario "Unreachable endpoint creates a trace" */
      it("records the connection error rather than a status", () => {
        const trace = traceFor({
          success: false,
          error: "connect ECONNREFUSED 127.0.0.1:9",
        });

        expect(trace.span.error).toMatchObject({
          has_error: true,
          message: "connect ECONNREFUSED 127.0.0.1:9",
        });
        expect(trace.span.output).toEqual({
          type: "json",
          value: { error: "connect ECONNREFUSED 127.0.0.1:9" },
        });
        expect(trace.span.output.value).not.toHaveProperty("status");
      });

      /** @scenario "Unreachable endpoint creates a trace" */
      it("still names the failure when the caller supplied no message", () => {
        const trace = traceFor({ success: false });

        expect(trace.span.error).toMatchObject({ has_error: true, message: "Request failed" });
      });
    });
  });

  describe("given a test request configured with an output path", () => {
    describe("when the trace for it is built", () => {
      /** @scenario "JSONPath extraction is captured in trace" */
      it("carries the extracted value beside the path it came from", () => {
        const trace = traceFor(
          {
            success: true,
            status: 200,
            response: { data: { answer: "extracted" } },
            extractedOutput: "extracted",
          },
          {
            testContext: buildTraceTestContext({
              url: "https://agent.test/answer",
              method: "POST",
              outputPath: "$.data.answer",
            }),
          },
        );

        expect(trace.span.output).toMatchObject({
          value: { extracted_output: "extracted" },
        });
        expect(trace.span.input).toMatchObject({
          value: { output_path: "$.data.answer" },
        });
        expect(trace.customMetadata.test_context).toMatchObject({
          output_path: "$.data.answer",
        });
      });
    });
  });
});

describe("buildTraceparentHeader()", () => {
  describe("given the ids minted for one test request", () => {
    describe("when the outgoing header is built", () => {
      /** @scenario "Traceparent header enables distributed tracing" */
      it("writes the W3C form and carries the ids the recorded span will hold", () => {
        const ids = generateTraceIds();

        const header = buildTraceparentHeader(ids);

        expect(ids.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(ids.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(header).toBe(`00-${ids.traceId}-${ids.spanId}-01`);

        const trace = traceFor(
          { success: true, status: 200 },
          { traceId: ids.traceId, spanId: ids.spanId },
        );

        expect(header).toBe(`00-${trace.traceId}-${trace.span.span_id}-01`);
      });

      /** @scenario "Traceparent header enables distributed tracing" */
      it("mints a different trace for every request", () => {
        expect(generateTraceIds().traceId).not.toBe(generateTraceIds().traceId);
      });
    });
  });
});
