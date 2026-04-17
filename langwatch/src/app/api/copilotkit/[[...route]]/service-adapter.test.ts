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

// ── Imports ───────────────────────────────────────────────────────────────────
import { beforeEach, describe, expect, it } from "vitest";
import * as traceUtils from "~/utils/trace";
import { PromptStudioAdapter } from "./service-adapter";

// ── Types ─────────────────────────────────────────────────────────────────────

type StreamEvent =
  | { type: "TextMessageStart"; messageId: string }
  | { type: "TextMessageContent"; messageId: string; content: string }
  | { type: "TextMessageEnd"; messageId: string };

/**
 * A minimal stub for RuntimeEventSource that captures stream events.
 * RuntimeEventSource is not exported from @copilotkit/runtime, so we build
 * a duck-typed object that satisfies the interface PromptStudioAdapter.process() uses.
 */
type MockEventSource = {
  stream: (
    callback: (eventStream$: MockEventStream) => Promise<void>,
  ) => Promise<void>;
  _events: StreamEvent[];
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
    _events: events,
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

/**
 * Builds a minimal CopilotRuntimeChatCompletionRequest with the given model string
 * (the adapter reads it as the serialised additionalParams blob).
 */
function buildRequest({
  model,
  eventSource,
}: {
  model: string;
  eventSource: MockEventSource;
}) {
  return {
    eventSource,
    messages: [],
    actions: [],
    threadId: "thread-test-123",
    forwardedParameters: { model },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PromptStudioAdapter", () => {
  let adapter: PromptStudioAdapter;

  beforeEach(() => {
    adapter = new PromptStudioAdapter({ projectId: "proj-test" });
    vi.restoreAllMocks();
  });

  describe("when forwardedParameters.model contains malformed JSON", () => {
    it("streams a Configuration Error message", async () => {
      const { eventSource, collect } = createMockEventSource();

      await adapter.process(
        buildRequest({ model: "{not valid json", eventSource }) as any,
      );

      const events = await collect();

      const contentEvent = events.find((e) => e.type === "TextMessageContent");
      expect(contentEvent).toBeDefined();
      expect((contentEvent as any).content).toContain("Configuration Error");
    });

    it("allocates traceId BEFORE attempting JSON.parse so the error stream uses a stable traceId", async () => {
      /**
       * With the current (buggy) code, generateOtelTraceId is called at line 89,
       * which comes AFTER JSON.parse at line 79. When line 79 throws, the generator
       * is never reached in the try block — the catch at line 147 calls it instead.
       *
       * The fix hoists `traceId = generateOtelTraceId()` to BEFORE the try block
       * (or at least before JSON.parse). At that point, when JSON.parse's spy fires,
       * the generator will already have been called.
       *
       * This test FAILS with the buggy code and PASSES after the fix.
       */
      let generateCalledCount = 0;
      let generateCalledBeforeParseAttempt = false;

      vi.spyOn(traceUtils, "generateOtelTraceId").mockImplementation(() => {
        generateCalledCount++;
        return `trace-fixed-${generateCalledCount}`;
      });

      // Override JSON.parse to capture the ordering, then throw as if malformed JSON
      vi.spyOn(JSON, "parse").mockImplementation(() => {
        generateCalledBeforeParseAttempt = generateCalledCount > 0;
        throw new SyntaxError("Unexpected token in JSON");
      });

      const { eventSource, collect } = createMockEventSource();

      await adapter.process(
        buildRequest({ model: "{not valid json", eventSource }) as any,
      );

      await collect();

      // FAILS with buggy code: generateOtelTraceId is called AFTER JSON.parse in
      // the try block (line 89 > line 79), so when JSON.parse's spy fires,
      // generateCalledCount is still 0.
      expect(generateCalledBeforeParseAttempt).toBe(true);
    });

    it("uses exactly one generateOtelTraceId call and pipes its result as the error messageId", async () => {
      /**
       * In the early-error path (JSON.parse throws), generateOtelTraceId must be
       * called exactly once and the resulting id must flow through as the
       * sendTextMessageStart messageId.
       *
       * This assertion is satisfied by both buggy and fixed code (in both cases the
       * generator is called once and its result is used), but it guards against
       * regressions where the id is dropped or a second random id is introduced.
       */
      let callCount = 0;
      vi.spyOn(traceUtils, "generateOtelTraceId").mockImplementation(() => {
        callCount++;
        return callCount === 1 ? "trace-first-call" : "trace-second-call";
      });

      const capturedMessageIds: string[] = [];
      const { eventSource, collect } = createMockEventSource();

      // Intercept sendTextMessageStart to capture the messageId
      const origStream = eventSource.stream.bind(eventSource);
      eventSource.stream = async (callback) => {
        return origStream(async (eventStream$) => {
          const wrapped: MockEventStream = {
            ...eventStream$,
            sendTextMessageStart: ({ messageId }) => {
              capturedMessageIds.push(messageId);
              eventStream$.sendTextMessageStart({ messageId });
            },
          };
          await callback(wrapped);
        });
      };

      await adapter.process(
        buildRequest({ model: "{not valid json", eventSource }) as any,
      );

      await collect();

      expect(capturedMessageIds).toHaveLength(1);
      expect(capturedMessageIds[0]).toBe("trace-first-call");
      expect(callCount).toBe(1);
    });
  });
});
