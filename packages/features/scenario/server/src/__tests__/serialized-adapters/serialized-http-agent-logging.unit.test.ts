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

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { createLogger, type Logger } from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "@langwatch/scenario-contract";
import {
  createMockHttpAgentAdapter,
  mockScenarioHttpFetch,
} from "../support/test-scenario-http.port";

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => ({
      headers,
      traceId: undefined,
    }),
  ),
}));

const mockSsrfSafeFetch = mockScenarioHttpFetch;

function makeFakeLogger(): Logger {
  const logger = createLogger("scenario-http-adapter-test");
  vi.spyOn(logger, "info").mockImplementation(() => void 0);
  vi.spyOn(logger, "warn").mockImplementation(() => void 0);
  vi.spyOn(logger, "error").mockImplementation(() => void 0);
  vi.spyOn(logger, "debug").mockImplementation(() => void 0);
  return logger;
}

const defaultConfig: HttpAgentData = {
  type: "http",
  agentId: "agent_log",
  url: "https://api.example.com/chat",
  method: "POST",
  headers: [],
  secrets: {},
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
  let logger: Logger;

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
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: vi.fn().mockResolvedValue({ response: "ok" }),
          text: vi.fn().mockResolvedValue("ok"),
        });

        const adapter = createMockHttpAgentAdapter({
          config: defaultConfig,
          logger,
        });

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

  describe("given a secret resolved into a header the name list does not cover", () => {
    describe("when the adapter logs the request", () => {
      /** @scenario "A resolved secret value is scrubbed from the request log line" */
      it("shows the placeholder in that header value", async () => {
        mockSsrfSafeFetch.mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: vi.fn().mockResolvedValue({ response: "ok" }),
          text: vi.fn().mockResolvedValue("ok"),
        });

        const adapter = createMockHttpAgentAdapter({
          config: {
            ...defaultConfig,
            headers: [{ key: "X-Custom-Token", value: "{{ secrets.AGENT_TOKEN }}" }],
            secrets: { AGENT_TOKEN: "tok-live-abc123" },
          },
          logger,
        });

        await adapter.call(defaultInput);

        // X-Custom-Token is not a name any list can know about. The value
        // scrub is what keeps the credential out of the log line.
        const [entry] = vi.mocked(logger.info).mock.calls[0] as [
          { headers: Record<string, string> },
        ];
        expect(entry.headers["X-Custom-Token"]).toBe("[redacted]");
        expect(JSON.stringify(entry)).not.toContain("tok-live-abc123");
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
        });

        const adapter = createMockHttpAgentAdapter({
          config: defaultConfig,
          logger,
        });

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

        const adapter = createMockHttpAgentAdapter({
          config: defaultConfig,
          logger,
        });

        await expect(adapter.call(defaultInput)).rejects.toThrow("ECONNREFUSED");

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
