/** @vitest-environment node
 * Structured logging in HttpSerializedHttpAgentChannel: every request logged
 * at appropriate level with CloudWatch-friendly fields (lw#3593).
 */

import type { Logger } from "@langwatch/observability";
import { type AgentInput, AgentRole } from "@langwatch/scenario";
import type { HttpAgentData } from "@langwatch/scenario-contract";
import { createTestLogger, type TestLogLines } from "@langwatch/test-harness";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockHttpAgentAdapter,
  mockScenarioHttpFetch,
} from "../support/test-scenario-http.fixture.ts";

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(({ headers }: { headers: Record<string, string> }) => ({
    headers,
    traceId: undefined,
  })),
}));

const mockSsrfSafeFetch = mockScenarioHttpFetch;

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
  let lines: TestLogLines;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ logger, lines } = createTestLogger());
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

        expect(lines.findLine("info", "http call ok")).toEqual(
          expect.objectContaining({
            url: "https://api.example.com/chat",
            method: "POST",
            statusCode: 200,
            durationMs: expect.any(Number),
          }),
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
        const entry = lines.findLine("info", "http call ok");
        expect(entry?.headers).toMatchObject({ "X-Custom-Token": "[redacted]" });
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

        expect(lines.findLine("warn", "http call failed")).toEqual(
          expect.objectContaining({
            url: "https://api.example.com/chat",
            method: "POST",
            statusCode: 503,
            durationMs: expect.any(Number),
            responseBodyPreview: expect.stringContaining("upstream busy"),
          }),
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

        expect(lines.findLine("error", "http call failed")).toEqual(
          expect.objectContaining({
            url: "https://api.example.com/chat",
            method: "POST",
            errorClass: "Error",
            message: "ECONNREFUSED",
          }),
        );
      });
    });
  });
});
