/**
 * @vitest-environment node
 *
 * Integration test for OTEL trace context propagation through the HTTP agent adapter.
 *
 * Uses a REAL OpenTelemetry TracerProvider and a local echo server to validate
 * the full propagation path: TracerProvider -> active span -> propagation.inject()
 * -> HTTP headers received by the target server.
 *
 * Covers feature spec scenarios:
 * - Serialized HTTP adapter injects traceparent header
 * - Trace headers coexist with custom headers
 * - Same trace ID is propagated across all turns of a conversation
 * - Adapter records the propagated trace ID for later ES query
 */

import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "../types";
import { createOtelEchoServer } from "./otel-echo-server";

// Mock ssrfSafeFetch to use native fetch, bypassing SSRF validation for localhost
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: async (url: string, init?: RequestInit) => {
    return fetch(url, init);
  },
}));

// Import adapter AFTER mock is set up
const { SerializedHttpAgentAdapter } = await import(
  "../serialized-adapters/http-agent.adapter"
);

const W3C_TRACEPARENT_REGEX =
  /^00-([a-f0-9]{32})-([a-f0-9]{16})-([0-9]{2})$/;

describe("HTTP trace context propagation", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let echoServer: Awaited<ReturnType<typeof createOtelEchoServer>>;

  beforeAll(async () => {
    // Set up real TracerProvider with in-memory exporter.
    // NodeTracerProvider.register() sets up both the global tracer provider
    // and the W3C trace context propagator automatically.
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();

    echoServer = await createOtelEchoServer();
  });

  afterAll(async () => {
    await echoServer.close();
    await provider.shutdown();
  });

  afterEach(() => {
    exporter.reset();
  });

  function createConfig(overrides?: Partial<HttpAgentData>): HttpAgentData {
    return {
      type: "http",
      agentId: "test-agent",
      url: echoServer.url,
      method: "POST",
      headers: [],
      outputPath: "$.choices[0].message.content",
      ...overrides,
    };
  }

  function createInput(overrides?: Partial<AgentInput>): AgentInput {
    return {
      threadId: "thread-1",
      messages: [{ role: "user", content: "Hello" }],
      newMessages: [{ role: "user", content: "Hello" }],
      requestedRole: AgentRole.AGENT,
      scenarioState: {} as AgentInput["scenarioState"],
      scenarioConfig: {} as AgentInput["scenarioConfig"],
      ...overrides,
    };
  }

  describe("given an active OTEL trace context", () => {
    describe("when the adapter makes a request", () => {
      it("includes a valid W3C traceparent header", async () => {
        const tracer = trace.getTracer("test");
        const span = tracer.startSpan("test-scenario");
        const ctx = trace.setSpan(context.active(), span);

        try {
          await context.with(ctx, async () => {
            const adapter = new SerializedHttpAgentAdapter(createConfig());
            await adapter.call(createInput());
          });
        } finally {
          span.end();
        }

        const requests = echoServer.getReceivedRequests();
        expect(requests).toHaveLength(1);

        const traceparent = requests[0]!.headers["traceparent"];
        expect(traceparent).toBeDefined();
        expect(traceparent).toMatch(W3C_TRACEPARENT_REGEX);
      });

      it("returns the propagated trace ID via getTraceId()", async () => {
        const tracer = trace.getTracer("test");
        const span = tracer.startSpan("test-scenario");
        const expectedTraceId = span.spanContext().traceId;
        const ctx = trace.setSpan(context.active(), span);

        let capturedTraceId: string | undefined;

        try {
          await context.with(ctx, async () => {
            const adapter = new SerializedHttpAgentAdapter(createConfig());
            await adapter.call(createInput());
            capturedTraceId = adapter.getTraceId();
          });
        } finally {
          span.end();
        }

        expect(capturedTraceId).toBe(expectedTraceId);
      });
    });
  });

  describe("given a multi-turn conversation", () => {
    describe("when the adapter makes requests for multiple turns", () => {
      it("propagates the same trace ID across all turns", async () => {
        const tracer = trace.getTracer("test");
        const span = tracer.startSpan("multi-turn-scenario");
        const expectedTraceId = span.spanContext().traceId;
        const ctx = trace.setSpan(context.active(), span);

        try {
          await context.with(ctx, async () => {
            const adapter = new SerializedHttpAgentAdapter(createConfig());

            // Simulate 3 turns
            await adapter.call(createInput({
              messages: [{ role: "user", content: "Turn 1" }],
              newMessages: [{ role: "user", content: "Turn 1" }],
            }));
            await adapter.call(createInput({
              messages: [
                { role: "user", content: "Turn 1" },
                { role: "assistant", content: "I can help with that." },
                { role: "user", content: "Turn 2" },
              ],
              newMessages: [{ role: "user", content: "Turn 2" }],
            }));
            await adapter.call(createInput({
              messages: [
                { role: "user", content: "Turn 1" },
                { role: "assistant", content: "I can help with that." },
                { role: "user", content: "Turn 2" },
                { role: "assistant", content: "I can help with that." },
                { role: "user", content: "Turn 3" },
              ],
              newMessages: [{ role: "user", content: "Turn 3" }],
            }));
          });
        } finally {
          span.end();
        }

        const requests = echoServer.getReceivedRequests();
        // Filter to just this test's requests (last 3)
        const turnRequests = requests.slice(-3);
        expect(turnRequests).toHaveLength(3);

        const traceIds = turnRequests.map((req) => {
          const traceparent = req.headers["traceparent"] as string;
          const match = traceparent.match(W3C_TRACEPARENT_REGEX);
          return match?.[1];
        });

        // All 3 turns use the same trace ID
        expect(traceIds[0]).toBe(expectedTraceId);
        expect(traceIds[1]).toBe(expectedTraceId);
        expect(traceIds[2]).toBe(expectedTraceId);
      });
    });
  });

  describe("given custom headers are configured", () => {
    describe("when the adapter makes a request", () => {
      it("preserves custom headers alongside trace context headers", async () => {
        const tracer = trace.getTracer("test");
        const span = tracer.startSpan("custom-headers-scenario");
        const ctx = trace.setSpan(context.active(), span);

        try {
          await context.with(ctx, async () => {
            const adapter = new SerializedHttpAgentAdapter(
              createConfig({
                headers: [
                  { key: "X-Custom-Auth", value: "token-abc" },
                  { key: "X-Request-Source", value: "test-suite" },
                ],
              }),
            );
            await adapter.call(createInput());
          });
        } finally {
          span.end();
        }

        const requests = echoServer.getReceivedRequests();
        const lastRequest = requests[requests.length - 1]!;

        // Custom headers are present
        expect(lastRequest.headers["x-custom-auth"]).toBe("token-abc");
        expect(lastRequest.headers["x-request-source"]).toBe("test-suite");

        // Trace header is also present
        expect(lastRequest.headers["traceparent"]).toMatch(W3C_TRACEPARENT_REGEX);
      });
    });
  });
});
