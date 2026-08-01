/**
 * @vitest-environment node
 *
 * spanDetail's coding-agent enrichment through the real tRPC router: claude
 * spans store their content in the trace's OTLP logs, and the single-span
 * read must join it on BEFORE the protections/redaction pass — a viewer the
 * policy hides content from must get redaction markers, never the joined
 * content. App-layer reads are stubbed (the annotation.integration pattern);
 * session + RBAC run against the real test database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const PROJECT_ID = "test-project-id";
const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const REQUEST_ID = "req_011CcuGBf1aBcDeFgHiJkLmN";
const TOOL_USE_ID = "toolu_01AbCdEfGhIjKlMnOpQrStUv";
const REPL = "repl_main_thread";

function storedSpan(over: Record<string, unknown>) {
  return {
    span_id: "span-1",
    parent_id: null,
    trace_id: TRACE_ID,
    type: "llm",
    name: "claude_code.llm_request",
    input: null,
    output: null,
    error: null,
    timestamps: {
      started_at: 1_700_000_000_000,
      finished_at: 1_700_000_001_000,
    },
    metrics: { prompt_tokens: 120, completion_tokens: 8 },
    params: { request_id: REQUEST_ID, query_source: REPL },
    model: "claude-sonnet-5",
    vendor: "anthropic",
    ...over,
  };
}

function logRow(attributes: Record<string, string>, timeUnixMs = 100) {
  return {
    traceId: TRACE_ID,
    spanId: "77bb432be48046f6",
    timeUnixMs,
    body: attributes["event.name"] ?? "",
    attributes,
    resourceAttributes: {},
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  };
}

const CLAUDE_LOGS = [
  logRow({
    "event.name": "user_prompt",
    prompt: "hello claudinho",
    query_source: REPL,
  }),
  logRow({
    "event.name": "api_request",
    request_id: REQUEST_ID,
    query_source: REPL,
    cost_usd: "0.16",
  }),
  logRow(
    {
      "event.name": "assistant_response",
      request_id: REQUEST_ID,
      query_source: REPL,
      response: "E aí! Tudo bem?",
    },
    500,
  ),
  logRow({
    "event.name": "tool_result",
    tool_use_id: TOOL_USE_ID,
    tool_name: "WebSearch",
    tool_input: '{"query":"pudim com br"}',
    success: "true",
    duration_ms: "6700",
    tool_result_size_bytes: "2048",
  }),
];

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getSpanById: vi.fn(),
    getSpanEvents: vi.fn().mockResolvedValue([]),
    getSpanSummaryByTraceId: vi.fn().mockResolvedValue([]),
    getLogsByTraceId: vi.fn(),
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: {
      spans: {
        getSpanById: mocks.getSpanById,
        getSpanEvents: mocks.getSpanEvents,
        getSpanSummaryByTraceId: mocks.getSpanSummaryByTraceId,
        getSpansByTraceId: vi.fn().mockResolvedValue([]),
      },
      logRecords: { getLogsByTraceId: mocks.getLogsByTraceId },
    },
  }),
}));

// Protections resolve per test case; RBAC/session still run for real.
const { protectionsMock } = vi.hoisted(() => ({
  protectionsMock: { current: {} as Record<string, unknown> },
}));
vi.mock("../../utils", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getVisibilityCutoffMsForProject: vi.fn().mockResolvedValue(null),
    getUserProtectionsForProject: vi
      .fn()
      .mockImplementation(() => Promise.resolve(protectionsMock.current)),
  };
});

const FULL_VISIBILITY = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

describe("tracesV2.spanDetail coding-agent enrichment", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("given a claude llm_request span whose content lives in logs", () => {
    it("joins prompt, reply, and authoritative cost onto the detail", async () => {
      protectionsMock.current = FULL_VISIBILITY;
      mocks.getSpanById.mockResolvedValue(storedSpan({}));
      mocks.getLogsByTraceId.mockResolvedValue(CLAUDE_LOGS);
      mocks.getSpanSummaryByTraceId.mockResolvedValue([
        {
          spanId: "span-1",
          requestId: REQUEST_ID,
          querySource: REPL,
          startTimeMs: 1_700_000_000_000,
        },
      ]);

      const detail = await caller.tracesV2.spanDetail({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: "span-1",
      });

      expect(detail.input).toContain("hello claudinho");
      expect(detail.output).toContain("E aí! Tudo bem?");
      expect(detail.metrics?.cost).toBe(0.16);
    });
  });

  describe("given a claude tool span", () => {
    it("joins the tool input and structured outcome", async () => {
      protectionsMock.current = FULL_VISIBILITY;
      mocks.getSpanSummaryByTraceId.mockClear();
      mocks.getSpanById.mockResolvedValue(
        storedSpan({
          span_id: "tool-span-1",
          type: "tool",
          name: "claude_code.tool",
          params: { tool_use_id: TOOL_USE_ID, tool_name: "WebSearch" },
          metrics: {},
        }),
      );
      mocks.getLogsByTraceId.mockResolvedValue(CLAUDE_LOGS);

      const detail = await caller.tracesV2.spanDetail({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: "tool-span-1",
      });

      expect(detail.input).toContain("pudim com br");
      expect(detail.output).toContain("completed");
      // Tool spans have no request_id — the sibling summary read must not run.
      expect(mocks.getSpanSummaryByTraceId).not.toHaveBeenCalled();
    });
  });

  describe("given a viewer the policy hides captured content from", () => {
    it("returns redaction markers, never the joined content (enrich-before-redact)", async () => {
      protectionsMock.current = {
        canSeeCosts: true,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: "Admins",
        capturedOutputVisibleTo: "Admins",
      };
      mocks.getSpanById.mockResolvedValue(storedSpan({}));
      mocks.getLogsByTraceId.mockResolvedValue(CLAUDE_LOGS);

      const detail = await caller.tracesV2.spanDetail({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: "span-1",
      });

      expect(detail.inputRedacted).toBe(true);
      expect(detail.outputRedacted).toBe(true);
      expect(detail.input ?? "").not.toContain("hello claudinho");
      expect(detail.output ?? "").not.toContain("E aí");
      expect(JSON.stringify(detail.params ?? {})).not.toContain(
        "hello claudinho",
      );
    });
  });

  describe("given the log read fails", () => {
    it("degrades to the un-enriched span instead of failing the read", async () => {
      protectionsMock.current = FULL_VISIBILITY;
      mocks.getSpanById.mockResolvedValue(storedSpan({}));
      mocks.getLogsByTraceId.mockRejectedValue(new Error("CH down"));

      const detail = await caller.tracesV2.spanDetail({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: "span-1",
      });

      expect(detail.spanId).toBe("span-1");
      expect(detail.input ?? null).toBeNull();
    });
  });

  describe("given a span that is not coding-agent shaped", () => {
    it("never reads the log store", async () => {
      protectionsMock.current = FULL_VISIBILITY;
      mocks.getLogsByTraceId.mockClear();
      mocks.getSpanById.mockResolvedValue(
        storedSpan({
          name: "openai.chat",
          params: {},
          model: "gpt-5-mini",
          vendor: "openai",
        }),
      );

      await caller.tracesV2.spanDetail({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        spanId: "span-1",
      });

      expect(mocks.getLogsByTraceId).not.toHaveBeenCalled();
    });
  });
});
