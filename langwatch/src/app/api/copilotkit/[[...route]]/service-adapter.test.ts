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
  toError: vi.fn((e) => e instanceof Error ? e : new Error(String(e))),
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
      // envelope shape that was passed in. The `!` propagates the
      // toHaveBeenCalled guarantee past TS's noUncheckedIndexedAccess.
      const firstCall = mocked.mock.calls[0]!;
      return (firstCall[0] as any).message;
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
      expect(userTurns[0]!.content).toBe("{{input}}");
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
      // Prior live history (older question + older reply) FIRST, then
      // the template's `{{input}}` slot which renders to the latest
      // "test7" turn at the END. Pre-2026-05-17 the order was inverted
      // — `{{input}}` shipped at index 0 and the live history trailed
      // behind, so the LLM read the latest user input as if it came
      // BEFORE every prior turn. The screenshot from rchaves caught
      // this: 'huh?' (latest) landed at messages[1] right after the
      // system prompt, with 'how big is mars?' (older) following.
      expect(sent.map((m) => m.content)).toEqual([
        "older question",
        "older reply",
        "{{input}}",
      ]);
      expect(envelope.payload.inputs.input).toBe("test7");
    });

    // 2026-05-17 prod regression — caught after #4098 merged.
    // rchaves: "huh?" was the LATEST user message in the playground,
    // but the trace shows it injected at messages[1] right after the
    // system slot, with the actual conversation history ("how big is
    // mars?", assistant reply, "thanks bro!", assistant reply)
    // following it. This test replays the exact multi-turn shape that
    // surfaced the bug.
    it("places the latest user turn at the END of the messages array, not after the system slot", async () => {
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "Welcome" },
              { role: "user", content: "{{input}}" },
            ],
          }),
          chatMessages: [
            { role: "user", content: "how big is mars?" },
            { role: "assistant", content: "Mars is 6,779 km in diameter." },
            { role: "user", content: "thanks bro!" },
            { role: "assistant", content: "You're welcome." },
            { role: "user", content: "huh?" },
          ],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      const sent: { role: string; content: string }[] = envelope.payload.inputs.messages;
      // Chronological history (everything BEFORE the latest user turn)
      // + template's `{{input}}` slot at the end, which the downstream
      // render will resolve to "huh?".
      expect(sent.map((m) => ({ role: m.role, content: m.content }))).toEqual([
        { role: "user", content: "how big is mars?" },
        { role: "assistant", content: "Mars is 6,779 km in diameter." },
        { role: "user", content: "thanks bro!" },
        { role: "assistant", content: "You're welcome." },
        { role: "user", content: "{{input}}" },
      ]);
      expect(envelope.payload.inputs.input).toBe("huh?");
    });

    it("absorbs the live turn when the template references {{input}} only in the system message", async () => {
      // 2026-05-17 dogfood (rchaves on a 'Messages mode' prompt): the
      // template's USER message is plain text ('answer it') and only
      // the SYSTEM contains `{{input}}`. The live chat must still be
      // absorbed (bound to inputs.input) and NOT also appended as a
      // duplicate user turn — Python parity is "absorb when {{input}}
      // is ANYWHERE in the template", not "only when a user template
      // contains it".
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "Reply about {{input}}" },
              { role: "user", content: "answer it" },
            ],
          }),
          chatMessages: [{ role: "user", content: "how much is 2+3" }],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      const sent: { role: string; content: string }[] = envelope.payload.inputs.messages;
      // ONE user turn — the template's explicit "answer it". The
      // live "how much is 2+3" is absorbed into inputs.input, not
      // appended as a second user turn.
      const userTurns = sent.filter((m) => m.role === "user");
      expect(userTurns).toEqual([{ role: "user", content: "answer it" }]);
      // The live chat is the value for {{input}} resolution.
      expect(envelope.payload.inputs.input).toBe("how much is 2+3");
    });

    it("appends the live turn normally when the template doesn't reference {{input}} anywhere", async () => {
      // Negative-direction guard for the absorb heuristic. When NO
      // template message (system or user) references `{{input}}`,
      // the live chat turn must still appear as its own user
      // message — otherwise users in 'Messages mode' with no
      // placeholder would have their chat silently dropped.
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "Be terse" },
              { role: "user", content: "answer it" },
            ],
          }),
          chatMessages: [{ role: "user", content: "how much is 2+3" }],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      const sent: { role: string; content: string }[] = envelope.payload.inputs.messages;
      expect(sent).toEqual([
        { role: "user", content: "answer it" },
        { role: "user", content: "how much is 2+3" },
      ]);
      // No `{{input}}` placeholder anywhere → no need to bind, but
      // bind still happens via the falsy-input fallback (kept for
      // back-compat with prompts that consume `input` indirectly).
      expect(envelope.payload.inputs.input).toBe("how much is 2+3");
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

    // 2026-05-17 prod regression: PromptStudioAdapter shipped to prod
    // skipping the bind because variablesDict.input was DEFINED but
    // empty-string. The saved-prompt template declares `input` in
    // configData.inputs, so the Variables tab UI always emits a row
    // `{identifier:"input", value:""}` even when the user typed nothing
    // — strict `=== undefined` missed that and left `{{input}}` empty
    // (then the absorb step dropped the live "test7" turn for good
    // measure, so the LLM only saw the system message and rambled
    // about playground variables). The earlier 5 unit tests passed
    // because they either omitted `input` from variables entirely or
    // supplied an explicit non-empty value — neither matches the
    // real-form "declared with empty default" shape that ships from
    // the UI. Falsy-check now treats missing OR empty as "panel not
    // set" so the live turn correctly fills the placeholder.
    it("binds the live user message when Variables panel has `input` declared with empty-string default", async () => {
      const { eventSource } = createMockEventSource();
      await runProcess(
        adapter,
        buildRequestWithChat({
          additionalParams: buildAdditionalParams({
            messages: [
              { role: "system", content: "Reply using {{input}} verbatim" },
              { role: "user", content: "{{input}}" },
            ],
            // This is the EXACT shape PromptPlaygroundChat ships from
            // the UI when the user hasn't typed into the Variables tab:
            // the row exists (because configData.inputs declares it),
            // but its `value` is the empty string. Pre-fix
            // `variablesDict.input === undefined` was false → bind
            // skipped → `{{input}}` resolved to ""  → "test7" lost
            // entirely (absorb dropped the live turn for the template
            // slot that then rendered to empty).
            variables: [{ identifier: "input", value: "" }],
          }),
          chatMessages: [{ role: "user", content: "test7" }],
          eventSource,
        }),
      );

      const envelope = lastPostedEvent();
      // CORE ASSERTION — bind happened despite the declared-but-empty
      // panel row. This is the field nlpgo reads to interpolate the
      // template's `{{input}}` placeholders against, both in the
      // system and the user-message slot.
      expect(envelope.payload.inputs.input).toBe("test7");
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
