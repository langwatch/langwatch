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
import { studioBackendPostEvent } from "../../workflows/post_event/post-event";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
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

  // 2026-05-16 prompt-playground regression — the saved-prompt template
  // carries `{{input}}` placeholders by default; the live chat turn must
  // (a) bind to the `input` variable so those placeholders resolve, and
  // (b) be ABSORBED by the template's user-message slot rather than
  // duplicated as a separate live turn. Trace evidence from rchaves
  // showed `{{input}}` rendering to empty AND the live turn appended
  // alongside it.
  describe("when the saved-prompt template references {{input}}", () => {
    /** Build a fresh formValues blob matching what PromptPlaygroundChat
     * forwards via `additionalParams.model`. */
    function buildAdditionalParams({
      messages: templateMessages,
      variables,
    }: {
      messages: { role: string; content: string }[];
      variables?: { identifier: string; value: string }[];
    }): string {
      return JSON.stringify({
        formValues: {
          version: {
            configData: {
              llm: { model: "openai/gpt-5-mini" },
              messages: templateMessages,
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
            },
          },
        },
        variables: variables ?? [],
      });
    }

    function buildRequestWithChat({
      additionalParams,
      chatMessages,
      eventSource,
    }: {
      additionalParams: string;
      chatMessages: { role: string; content: string }[];
      eventSource: MockEventSource;
    }): RequestForProcess {
      return {
        eventSource,
        messages: chatMessages as any,
        actions: [],
        threadId: "thread-test-input-binding",
        forwardedParameters: {
          model: additionalParams,
        } as CopilotRuntimeChatCompletionRequest["forwardedParameters"],
      } as RequestForProcess;
    }

    function lastPostedEvent(): any {
      const mocked = vi.mocked(studioBackendPostEvent);
      expect(mocked, "studioBackendPostEvent must have been called").toHaveBeenCalled();
      // The component_state_change consumer is async; we only need the
      // envelope shape that was passed in.
      return mocked.mock.calls[0][0].message;
    }

    beforeEach(() => {
      vi.mocked(studioBackendPostEvent).mockReset();
      vi.mocked(studioBackendPostEvent).mockResolvedValue(undefined as any);
      vi.mocked(addEnvs).mockImplementation(async (event: any) => event);
      vi.mocked(loadDatasets).mockImplementation(async (event: any) => event);
    });

    it("binds the latest live user-message content to inputs.input", async () => {
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "Reply using {{input}} verbatim" },
              { role: "user", content: "{{input}}" },
            ],
          }),
          chatMessages: [{ role: "user", content: "test7" }],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      expect(envelope.payload.inputs.input).toBe("test7");
    });

    it("absorbs the live user-message into the template slot (no duplicate turn)", async () => {
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "system" },
              { role: "user", content: "{{input}}" },
            ],
          }),
          chatMessages: [{ role: "user", content: "test7" }],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      const sent: { role: string; content: string }[] = envelope.payload.inputs.messages;
      // Exactly one user turn — the template's `{{input}}` slot, NOT a
      // duplicated live "test7" turn. Server-side render will resolve
      // the placeholder against inputs.input.
      const userTurns = sent.filter((m) => m.role === "user");
      expect(userTurns).toHaveLength(1);
      expect(userTurns[0].content).toBe("{{input}}");
    });

    it("keeps prior assistant + user turns when the template absorbs only the latest live turn", async () => {
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "system" },
              { role: "user", content: "{{input}}" },
            ],
          }),
          chatMessages: [
            { role: "user", content: "older question" },
            { role: "assistant", content: "older reply" },
            { role: "user", content: "test7" },
          ],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      const sent: { role: string; content: string }[] = envelope.payload.inputs.messages;
      // Template's `{{input}}` turn + 2 prior live turns (older question
      // + older reply). The latest "test7" turn is absorbed.
      expect(sent.map((m) => m.content)).toEqual([
        "{{input}}",
        "older question",
        "older reply",
      ]);
      expect(envelope.payload.inputs.input).toBe("test7");
    });

    it("appends the live turn normally when the template has no {{input}} user-slot", async () => {
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              // system references {{input}} for var binding, but there
              // is NO template user turn to absorb the live message,
              // so it must still appear as its own turn.
              { role: "system", content: "Echo {{input}} back" },
            ],
          }),
          chatMessages: [{ role: "user", content: "test7" }],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      const sent: { role: string; content: string }[] = envelope.payload.inputs.messages;
      expect(sent).toEqual([{ role: "user", content: "test7" }]);
      // Still bind input so the system's {{input}} resolves.
      expect(envelope.payload.inputs.input).toBe("test7");
    });

    it("does not override an explicit `input` value from the Variables panel", async () => {
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "system" },
              { role: "user", content: "{{input}}" },
            ],
            variables: [{ identifier: "input", value: "explicit-value" }],
          }),
          chatMessages: [{ role: "user", content: "test7" }],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      expect(envelope.payload.inputs.input).toBe("explicit-value");
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
