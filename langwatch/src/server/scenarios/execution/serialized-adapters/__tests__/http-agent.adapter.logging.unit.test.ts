/**
 * @vitest-environment node
 *
 * Unit tests for the structured logging path in SerializedHttpAgentAdapter.
 *
 * Tracking lw#3593 — adapter must log every request (success and failure)
 * at info/warn/error level with enough fields to reconstruct the call from
 * CloudWatch.
 *
 * @see specs/scenarios/observability-context.feature
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "../../types";
import { SerializedHttpAgentAdapter } from "../http-agent.adapter";

vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../../trace-context-headers", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => ({
      headers,
      traceId: undefined,
    }),
  ),
}));

import { ssrfSafeFetch } from "~/utils/ssrfProtection";

const mockSsrfSafeFetch = vi.mocked(ssrfSafeFetch);

interface FakeLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: () => FakeLogger;
}

function makeFakeLogger(): FakeLogger {
  const fake: FakeLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => fake,
  };
  return fake;
}

const defaultConfig: HttpAgentData = {
  type: "http",
  agentId: "agent_log",
  url: "https://api.example.com/chat",
  method: "POST",
  headers: [],
  outputPath: "$.response",
};

const defaultInput: AgentInput = {
  threadId: "thread_log",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

describe("SerializedHttpAgentAdapter — logging (lw#3593)", () => {
  let logger: FakeLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeFakeLogger();
  });

  describe("given the upstream returns 200", () => {
    describe("when the adapter executes a request", () => {
      /** @scenario HTTP adapter logs successful calls with url, method, status, latency */
      it("emits an info entry with url, method, statusCode, durationMs", async () => {
        mockSsrfSafeFetch.mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: vi.fn().mockResolvedValue({ response: "ok" }),
          text: vi.fn().mockResolvedValue("ok"),
        } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

        const adapter = new SerializedHttpAgentAdapter(
          defaultConfig,
          logger as unknown as ConstructorParameters<
            typeof SerializedHttpAgentAdapter
          >[1],
        );

        await adapter.call(defaultInput);

        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            url: "https://api.example.com/chat",
            method: "POST",
            statusCode: 200,
            durationMs: expect.any(Number),
          }),
          "http call ok",
        );
      });
    });
  });

  describe("given the upstream returns 503 with a body", () => {
    describe("when the adapter executes a request", () => {
      /** @scenario HTTP adapter logs non-2xx responses with body preview */
      it("emits a warn entry with statusCode and a responseBodyPreview", async () => {
        mockSsrfSafeFetch.mockResolvedValue({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
          headers: new Headers({ "content-type": "text/plain" }),
          json: vi.fn(),
          text: vi.fn().mockResolvedValue("upstream busy"),
        } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

        const adapter = new SerializedHttpAgentAdapter(
          defaultConfig,
          logger as unknown as ConstructorParameters<
            typeof SerializedHttpAgentAdapter
          >[1],
        );

        await expect(adapter.call(defaultInput)).rejects.toThrow(/HTTP 503/);

        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            url: "https://api.example.com/chat",
            method: "POST",
            statusCode: 503,
            durationMs: expect.any(Number),
            responseBodyPreview: expect.stringContaining("upstream busy"),
          }),
          "http call failed",
        );
      });
    });
  });

  describe("given the network call rejects with ECONNREFUSED", () => {
    describe("when the adapter executes a request", () => {
      /** @scenario HTTP adapter logs network failures with error class */
      it("emits an error entry with errorClass and message", async () => {
        mockSsrfSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

        const adapter = new SerializedHttpAgentAdapter(
          defaultConfig,
          logger as unknown as ConstructorParameters<
            typeof SerializedHttpAgentAdapter
          >[1],
        );

        await expect(adapter.call(defaultInput)).rejects.toThrow(
          "ECONNREFUSED",
        );

        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            url: "https://api.example.com/chat",
            method: "POST",
            errorClass: "Error",
            message: "ECONNREFUSED",
          }),
          "http call failed",
        );
      });
    });
  });
});
