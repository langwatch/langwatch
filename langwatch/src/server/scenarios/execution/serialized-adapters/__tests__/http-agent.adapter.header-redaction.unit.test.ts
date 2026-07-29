/**
 * @vitest-environment node
 *
 * The header a scenario target's credential arrives under is chosen by the
 * USER — `auth: { type: "api_key", header, value }` takes the header name from
 * config, and `headers: [{ key, value }]` adds arbitrary pairs on top. A
 * deny-list of known-sensitive names ("authorization", "x-api-key") therefore
 * only redacts the secrets whose header name the platform happened to guess:
 * a target authenticating with `X-Auth-Token` had its key written verbatim
 * into the structured log on EVERY call, success included.
 *
 * These tests pin the inverted rule: log the value only for header names on a
 * small allow-list, redact everything else.
 *
 * @see specs/scenarios/observability-context.feature
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "../../types";
import { SerializedHttpAgentAdapter } from "../http-agent.adapter";

vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => {
      headers.traceparent =
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
      return { headers, traceId: "4bf92f3577b34da6a3ce929d0e0e4736" };
    },
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

const CUSTOM_AUTH_HEADER = "X-Auth-Token";
const CUSTOM_AUTH_SECRET = "sk-live-scenario-target-secret";
const COOKIE_SECRET = "session=super-secret-session-value";

const input: AgentInput = {
  threadId: "thread_redaction",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

function makeConfig(overrides: Partial<HttpAgentData> = {}): HttpAgentData {
  return {
    type: "http",
    agentId: "agent_redaction",
    url: "https://api.example.com/chat",
    method: "POST",
    headers: [],
    outputPath: "$.response",
    ...overrides,
  };
}

function makeAdapter(config: HttpAgentData, logger: FakeLogger) {
  return new SerializedHttpAgentAdapter(
    config,
    logger as unknown as ConstructorParameters<
      typeof SerializedHttpAgentAdapter
    >[1],
  );
}

function mockOk() {
  mockSsrfSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: vi.fn().mockResolvedValue({ response: "ok" }),
    text: vi.fn().mockResolvedValue("ok"),
  } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
}

function mock503() {
  mockSsrfSafeFetch.mockResolvedValue({
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
    headers: new Headers({ "content-type": "text/plain" }),
    json: vi.fn(),
    text: vi.fn().mockResolvedValue("upstream busy"),
  } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
}

/** Every field the adapter passed to the logger, flattened to one string. */
function loggedPayloads(logger: FakeLogger): string {
  return JSON.stringify([
    ...logger.info.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.error.mock.calls,
    ...logger.debug.mock.calls,
  ]);
}

function loggedHeaders(
  call: readonly unknown[] | undefined,
): Record<string, string> {
  const fields = call?.[0] as { headers?: Record<string, string> } | undefined;
  return fields?.headers ?? {};
}

describe("SerializedHttpAgentAdapter — header redaction", () => {
  let logger: FakeLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeFakeLogger();
  });

  describe("given the target authenticates with a user-named api_key header", () => {
    const config = makeConfig({
      auth: {
        type: "api_key",
        header: CUSTOM_AUTH_HEADER,
        value: CUSTOM_AUTH_SECRET,
      },
    });

    describe("when the call succeeds", () => {
      it("redacts the custom auth header in the success log", async () => {
        mockOk();

        await makeAdapter(config, logger).call(input);

        expect(loggedHeaders(logger.info.mock.calls[0])).toMatchObject({
          [CUSTOM_AUTH_HEADER]: "[REDACTED]",
        });
      });

      it("never writes the secret value into any log entry", async () => {
        mockOk();

        await makeAdapter(config, logger).call(input);

        expect(loggedPayloads(logger)).not.toContain(CUSTOM_AUTH_SECRET);
      });

      it("still sends the real secret upstream", async () => {
        mockOk();

        await makeAdapter(config, logger).call(input);

        const sentHeaders = (
          mockSsrfSafeFetch.mock.calls[0]?.[1] as {
            headers: Record<string, string>;
          }
        ).headers;
        expect(sentHeaders[CUSTOM_AUTH_HEADER]).toBe(CUSTOM_AUTH_SECRET);
      });
    });

    describe("when the upstream returns a non-2xx status", () => {
      it("never writes the secret value into any log entry", async () => {
        mock503();

        await expect(makeAdapter(config, logger).call(input)).rejects.toThrow(
          /HTTP 503/,
        );

        expect(loggedPayloads(logger)).not.toContain(CUSTOM_AUTH_SECRET);
      });
    });

    describe("when the network call rejects", () => {
      it("never writes the secret value into any log entry", async () => {
        mockSsrfSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));

        await expect(makeAdapter(config, logger).call(input)).rejects.toThrow(
          "ECONNREFUSED",
        );

        expect(loggedPayloads(logger)).not.toContain(CUSTOM_AUTH_SECRET);
      });
    });
  });

  describe("given the target carries an arbitrary configured header", () => {
    describe("when the call succeeds", () => {
      it("redacts a header name no deny-list would have listed", async () => {
        mockOk();
        const config = makeConfig({
          headers: [
            { key: "Cookie", value: COOKIE_SECRET },
            { key: "apikey", value: "lowercase-unhyphenated-secret" },
          ],
        });

        await makeAdapter(config, logger).call(input);

        expect(loggedHeaders(logger.info.mock.calls[0])).toMatchObject({
          Cookie: "[REDACTED]",
          apikey: "[REDACTED]",
        });
        expect(loggedPayloads(logger)).not.toContain(COOKIE_SECRET);
      });
    });
  });

  describe("given only protocol headers the adapter sets itself", () => {
    describe("when the call succeeds", () => {
      it("keeps content-type and traceparent readable", async () => {
        mockOk();

        await makeAdapter(makeConfig(), logger).call(input);

        expect(loggedHeaders(logger.info.mock.calls[0])).toMatchObject({
          "Content-Type": "application/json",
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        });
      });
    });
  });
});
