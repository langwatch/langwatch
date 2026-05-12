/**
 * Integration tests for PromptStudioAdapter.process() error handling.
 *
 * Regression for issue #853: when JSON.parse throws early (malformed model param),
 * the catch block must use a traceId that was allocated BEFORE the parse attempt —
 * not mint a fresh one. Otherwise the frontend queries a traceId that has no
 * corresponding backend trace and shows "trace not found".
 */

// ── Module mocks (hoisted before imports by vitest) ───────────────────────────
// These modules pull in @aws-sdk/client-sts and other packages not installed
// in the test environment. They are never called in the early-error code path
// under test, so stubs are sufficient.
import { vi } from "vitest";

vi.mock("~/server/api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUniqueOrThrow: vi.fn() },
    projectSecret: { findMany: vi.fn() },
  },
}));

vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
  decrypt: vi.fn((v: string) => v.replace("encrypted:", "")),
}));

vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(),
  getS3CacheKey: vi.fn(),
}));

vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: vi.fn(),
}));

// Mocks the relative import used by service-adapter.ts
vi.mock("../../workflows/post_event/post-event", () => ({
  studioBackendPostEvent: vi.fn(),
}));

vi.mock("~/optimization_studio/server/lambda", () => ({
  invokeLambda: vi.fn(),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

// Mock the trace id generator so tests can assert call count and deterministic ids.
// vi.hoisted() lets the mock fn be referenced inside the hoisted vi.mock factory.
const { generateOtelTraceIdMock } = vi.hoisted(() => ({
  generateOtelTraceIdMock: vi.fn<() => string>(),
}));
vi.mock("~/utils/trace", async () => {
  const actual = await vi.importActual<typeof import("~/utils/trace")>(
    "~/utils/trace",
  );
  return {
    ...actual,
    generateOtelTraceId: generateOtelTraceIdMock,
  };
});

// ── Imports ───────────────────────────────────────────────────────────────────
import type {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "@copilotkit/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { PromptStudioAdapter } from "./service-adapter";

// ── Types ─────────────────────────────────────────────────────────────────────

type StreamEvent =
  | { type: "TextMessageStart"; messageId: string }
  | { type: "TextMessageContent"; messageId: string; content: string }
  | { type: "TextMessageEnd"; messageId: string };

/**
 * Minimal duck-typed stand-in for RuntimeEventSource. The real type is not
 * exported from @copilotkit/runtime; PromptStudioAdapter.process() only ever
 * calls `.stream(cb)` and the eventStream$ methods used inside the callback,
 * so we satisfy that surface.
 */
type MockEventSource = {
  stream: (
    callback: (eventStream$: MockEventStream) => Promise<void>,
  ) => Promise<void>;
};

type MockEventStream = {
  sendTextMessageStart: (args: { messageId: string }) => void;
  sendTextMessageContent: (args: {
    messageId: string;
    content: string;
  }) => void;
  sendTextMessageEnd: (args: { messageId: string }) => void;
  complete: () => void;
};

// `process()` typing requires the real RuntimeEventSource; our duck-typed mock
// satisfies the runtime surface but not the structural type.
type RequestForProcess = Omit<
  CopilotRuntimeChatCompletionRequest,
  "eventSource"
> & { eventSource: MockEventSource };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a mock eventSource that collects all stream events synchronously.
 * The `collect()` promise resolves once `complete()` is called inside the stream.
 */
function createMockEventSource(): {
  eventSource: MockEventSource;
  collect: () => Promise<StreamEvent[]>;
} {
  const events: StreamEvent[] = [];
  let resolveCollect!: (events: StreamEvent[]) => void;
  const collectPromise = new Promise<StreamEvent[]>((resolve) => {
    resolveCollect = resolve;
  });

  const eventSource: MockEventSource = {
    stream: async (callback) => {
      const eventStream$: MockEventStream = {
        sendTextMessageStart: ({ messageId }) => {
          events.push({ type: "TextMessageStart", messageId });
        },
        sendTextMessageContent: ({ messageId, content }) => {
          events.push({ type: "TextMessageContent", messageId, content });
        },
        sendTextMessageEnd: ({ messageId }) => {
          events.push({ type: "TextMessageEnd", messageId });
        },
        complete: () => {
          resolveCollect(events);
        },
      };
      await callback(eventStream$);
    },
  };

  return { eventSource, collect: () => collectPromise };
}

function buildRequest({
  model,
  eventSource,
}: {
  model: string;
  eventSource: MockEventSource;
}): RequestForProcess {
  return {
    eventSource,
    messages: [],
    actions: [],
    threadId: "thread-test-123",
    forwardedParameters: { model } as CopilotRuntimeChatCompletionRequest["forwardedParameters"],
  } as RequestForProcess;
}

async function runProcess(
  adapter: PromptStudioAdapter,
  request: RequestForProcess,
): Promise<CopilotRuntimeChatCompletionResponse> {
  return adapter.process(
    request as unknown as CopilotRuntimeChatCompletionRequest,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PromptStudioAdapter", () => {
  let adapter: PromptStudioAdapter;

  beforeEach(() => {
    adapter = new PromptStudioAdapter({ projectId: "proj-test" });
    generateOtelTraceIdMock.mockReset();
    let callCount = 0;
    generateOtelTraceIdMock.mockImplementation(() => {
      callCount++;
      return `trace-mock-${callCount}`;
    });
  });

  describe("when forwardedParameters.model contains malformed JSON", () => {
    it("streams a Configuration Error message", async () => {
      const { eventSource, collect } = createMockEventSource();

      await runProcess(
        adapter,
        buildRequest({ model: "{not valid json", eventSource }),
      );

      const events = await collect();

      const contentEvent = events.find((e) => e.type === "TextMessageContent");
      expect(contentEvent).toBeDefined();
      if (contentEvent?.type === "TextMessageContent") {
        expect(contentEvent.content).toContain("Configuration Error");
      }
    });

    it("uses the pre-allocated traceId as the streamed messageId so the frontend can find the trace", async () => {
      /**
       * Regression for #853. With the buggy code, the catch block called
       * generateOtelTraceId() a SECOND time to mint a fresh messageId, which
       * had no relationship to anything traceable. The fix allocates traceId
       * once at the top of process() and reuses it in the catch block.
       *
       * Assertion: generateOtelTraceId is called exactly once, AND the streamed
       * messageId equals that single id. Buggy code would either call it twice
       * (and the streamed id would equal call #2, not #1) or use the wrong id.
       */
      const { eventSource, collect } = createMockEventSource();

      await runProcess(
        adapter,
        buildRequest({ model: "{not valid json", eventSource }),
      );

      const events = await collect();
      const startEvent = events.find((e) => e.type === "TextMessageStart");

      expect(generateOtelTraceIdMock).toHaveBeenCalledTimes(1);
      expect(startEvent).toBeDefined();
      if (startEvent?.type === "TextMessageStart") {
        expect(startEvent.messageId).toBe("trace-mock-1");
      }
    });

    it("uses the same messageId across start, content, and end events", async () => {
      const { eventSource, collect } = createMockEventSource();

      await runProcess(
        adapter,
        buildRequest({ model: "{not valid json", eventSource }),
      );

      const events = await collect();
      const ids = new Set(events.map((e) => e.messageId));

      expect(ids.size).toBe(1);
      expect(ids.has("trace-mock-1")).toBe(true);
    });
  });
});
