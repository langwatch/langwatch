/**
 * The protections-parameterized transcript read shared by the tRPC procedure
 * and the REST route (`GET /api/traces/:traceId/transcript`). The app-layer
 * span/log stores are mocked boundaries; the log visibility gate and the
 * transcript derivation run for real, so what these tests pin is the actual
 * document an API-key caller receives.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { openProtections } from "~/server/traces/__tests__/open-protections";
import { TestCodingAgentService } from "~/test-utils/test-coding-agent.service";

const { mockGetSpansByTraceId, mockGetLogsByTraceId } = vi.hoisted(() => ({
  mockGetSpansByTraceId: vi.fn(),
  mockGetLogsByTraceId: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    traces: {
      spans: { getSpansByTraceId: mockGetSpansByTraceId },
      logRecords: { getLogsByTraceId: mockGetLogsByTraceId },
    },
  }),
}));

vi.mock("~/server/api/utils", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getVisibilityCutoffMsForProject: vi.fn(async () => 0),
}));

import { TracesV2TrpcApi } from "@langwatch/trace-server";
import { createTraceViewReadPorts } from "~/runtime/app/features/trace";

const PROJECT_ID = "project_test";
const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const codingAgents = TestCodingAgentService.create();

/**
 * The reader now takes the application it reads through, and the ports the
 * package does not own. The stores below are the mocked boundaries; the log
 * visibility gate and the transcript derivation still run for real.
 */
const app = {
  traces: {
    spans: { getSpansByTraceId: mockGetSpansByTraceId },
    logRecords: { getLogsByTraceId: mockGetLogsByTraceId },
    canonicalisation: undefined,
  },
  codingAgents,
} as never;
const ports = createTraceViewReadPorts();

function claudeLogRow(attributes: Record<string, string>, timeUnixMs: number) {
  return {
    traceId: TRACE_ID,
    spanId: "77bb432be48046f6",
    timeUnixMs,
    body: attributes["event.name"] ?? "",
    attributes,
    resourceAttributes: { "service.name": "claude-code" },
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  };
}

describe("readCodingAgentTranscriptWithProtections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSpansByTraceId.mockResolvedValue([]);
  });

  describe("given a coding-agent trace with stored log records", () => {
    /** @scenario transcript endpoint returns the derived transcript for a coding-agent trace */
    it("returns the derived transcript the terminal view derives", async () => {
      mockGetLogsByTraceId.mockResolvedValue([
        claudeLogRow(
          {
            "event.name": "claude_code.user_prompt",
            prompt: "summarise the repo",
            "session.id": "session-123",
          },
          100,
        ),
        claudeLogRow(
          {
            "event.name": "claude_code.assistant_response",
            response: "Here is the summary.",
          },
          300,
        ),
      ]);

      const transcript = await TracesV2TrpcApi.readCodingAgentTranscript({
        app,
        ports,
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        protections: openProtections,
        codingAgents,
      });

      expect(transcript.agent).toBe("claude_code");
      expect(transcript.sessionId).toBe("session-123");
      const kinds = transcript.entries.map((entry) => entry.kind);
      expect(kinds).toContain("user_prompt");
      const prompt = transcript.entries.find((entry) => entry.kind === "user_prompt");
      expect(prompt && "text" in prompt ? prompt.text : null).toBe("summarise the repo");
    });
  });

  describe("given a trace without coding-agent content", () => {
    /** @scenario transcript endpoint answers empty for a trace without coding-agent content */
    it("answers an empty transcript rather than an error", async () => {
      mockGetLogsByTraceId.mockResolvedValue([
        {
          traceId: TRACE_ID,
          spanId: "aaaa432be48046f6",
          timeUnixMs: 100,
          body: "GET /users",
          attributes: { "http.method": "GET" },
          resourceAttributes: { "service.name": "my-app" },
          scopeName: "my-app-logger",
          scopeVersion: null,
        },
      ]);

      const transcript = await TracesV2TrpcApi.readCodingAgentTranscript({
        app,
        ports,
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        protections: openProtections,
        codingAgents,
      });

      expect(transcript.entries).toEqual([]);
      expect(transcript.totals.modelCalls).toBe(0);
    });
  });
});
