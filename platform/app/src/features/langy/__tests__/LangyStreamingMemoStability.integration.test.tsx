/**
 * @vitest-environment jsdom
 *
 * What a streamed token is allowed to change, and what it is not.
 *
 * `MessageContent` is `memo`'d and there is one of it per message, so every
 * prop the panel hands it is on the hot path: a value that is rebuilt per
 * render makes the memo buy nothing, and a 40-message conversation re-runs
 * every message's tool-part scan on every token of the answer being typed into
 * the last one.
 *
 * Two props are load-bearing that way and neither is visible from the outside:
 * `choicesTimeline` (rebuilt from the whole message list, held stable BY VALUE
 * behind `choicesTimelineRef`) and `onChoiceSelect` (held stable by
 * `selectChoiceImplementationRef`, because the engine's `sendMessage` and
 * `isBusy` both move under a live turn). Swap either back to a plain
 * `useMemo`/`useCallback` and nothing else in the suite notices.
 *
 * So this drives a real streamed append through the real panel and asserts the
 * identities survive it. Boundary mocks only: the project context, `~/utils/api`,
 * `@ai-sdk/react`, and `MessageContent` itself — which is the seam under test,
 * recorded rather than rendered.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";
const CONVERSATION_ID = "conv-open";
const BLOCK_ID = "b-choices";

/** Every `MessageContent` render, in order, with the props it was handed. */
const rendered: Array<Record<string, unknown>> = [];

vi.mock("../components/MessageContent", () => ({
  MessageContent: (props: Record<string, unknown>) => {
    rendered.push(props);
    return <div data-testid="message" />;
  },
  ProposalCard: () => null,
}));

/**
 * The chat engine as real state.
 *
 * `sendMessage` is minted fresh on every read on purpose: @ai-sdk/react gives
 * no stability guarantee for it, and the panel's own note says it "moves under
 * a live turn". A `useCallback` that listed it would therefore churn per
 * render — the exact regression the implementation ref exists to prevent.
 */
interface EngineMessage {
  id: string;
  role: string;
  parts: unknown[];
}
const engine: {
  messages: EngineMessage[];
  version: number;
  listeners: Set<() => void>;
} = { messages: [], version: 0, listeners: new Set() };

vi.mock("@ai-sdk/react", async () => {
  const React = await import("react");
  return {
    useChat: () => {
      React.useSyncExternalStore(
        (notify: () => void) => {
          engine.listeners.add(notify);
          return () => engine.listeners.delete(notify);
        },
        () => engine.version,
        () => engine.version,
      );
      return {
        messages: engine.messages,
        status: "streaming",
        error: undefined,
        sendMessage: () => undefined,
        setMessages: (messages: EngineMessage[]) => {
          engine.messages = messages;
          engine.version++;
          engine.listeners.forEach((notify) => notify());
        },
        stop: () => undefined,
        clearError: () => undefined,
        regenerate: () => undefined,
      };
    },
  };
});

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(public opts: unknown) {}
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: PROJECT_ID, slug: "demo" },
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("@paper-design/shaders-react", () => ({ MeshGradient: () => null }));

vi.mock("~/utils/api", async () => {
  const { createTrpcUtils, idleQuery, withFallback } =
    await import("./support/langyApiMock");
  const trpcUtils = createTrpcUtils();

  return {
    api: withFallback({
      langy: withFallback({
        // The durable read answers with the same conversation the engine
        // already holds. The panel hydrates it once on open, and a hydration
        // that disagreed with the engine would move the timeline for a reason
        // that has nothing to do with the streamed token under test.
        messages: {
          useQuery: () => ({
            ...idleQuery(),
            data: {
              messages: durableConversation(),
              lastError: null,
              isTurnInFlight: false,
              inFlightTurnId: null,
              shouldAskFeedback: false,
              eventCursor: null,
              currentTurnId: null,
            },
            isSuccess: true,
          }),
        },
        modelsAllowed: {
          useQuery: () => ({
            data: { modelsAllowed: null },
            isLoading: false,
            isError: false,
          }),
        },
        stopTurn: {
          useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
        },
        onConversationUpdate: { useSubscription: () => undefined },
      }),
      useUtils: () => trpcUtils,
      useContext: () => trpcUtils,
      modelProvider: {
        setRoleAssignmentForScope: {
          useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
        },
        setFeatureOverrideForScope: {
          useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
        },
        getResolvedDefault: {
          useQuery: () => ({
            data: { model: "openai/gpt-5-mini" },
            isLoading: false,
          }),
        },
        listAllForProjectForFrontend: {
          useQuery: () => ({ data: { providers: [] }, isLoading: false }),
        },
      },
      virtualKeys: {
        list: { useQuery: () => ({ data: undefined, isLoading: false }) },
      },
      github: {
        getConnectionStatus: {
          useQuery: () => ({
            data: undefined,
            isLoading: false,
            isError: true,
          }),
        },
        disconnect: {
          useMutation: () => ({ mutate: () => undefined, isPending: false }),
        },
      },
    }),
  };
});

import { LangySidecar } from "../components/LangyPanel";
import { LangyProvider } from "../LangyContext";
import { useLangyStore } from "../stores/langyStore";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

/**
 * A settled turn that asked a question, plus however much of the next answer
 * has streamed in. Rebuilt WHOLE each time, the way @ai-sdk/react does it
 * (it `structuredClone`s the message on every update), so nothing about the
 * stability under test can come from a shared object reference.
 */
function conversationWith(answerSoFar: string): EngineMessage[] {
  return [
    {
      id: "m-user",
      role: "user",
      parts: [{ type: "text", text: "which agent should this run against?" }],
    },
    {
      id: "m-question",
      role: "assistant",
      parts: [
        {
          type: "langy-card",
          blockId: BLOCK_ID,
          kind: "choices",
          provenance: "derived",
          card: {
            kind: "choices",
            blockId: BLOCK_ID,
            question: "Which agent should this scenario run against?",
            options: [
              { id: "staging", label: "Staging agent" },
              { id: "prod", label: "Production agent" },
            ],
          },
        },
      ],
    },
    {
      id: "m-answer",
      role: "assistant",
      parts: [{ type: "text", text: answerSoFar }],
    },
  ];
}

/** The same conversation as the durable read returns it. */
function durableConversation() {
  return conversationWith("Looking").map((message, index) => ({
    ...message,
    createdAtMs: index,
  }));
}

const streamToken = (answerSoFar: string) =>
  act(() => {
    engine.messages = conversationWith(answerSoFar);
    engine.version++;
    engine.listeners.forEach((notify) => notify());
  });

/** The props the LAST render handed the message carrying the choices card. */
const lastPropsFor = (messageId: string) =>
  [...rendered]
    .reverse()
    .find((props) => (props.message as { id?: string } | undefined)?.id === messageId);

describe("given a conversation with an open choices card", () => {
  beforeEach(() => {
    rendered.length = 0;
    engine.messages = conversationWith("Looking");
    engine.version = 0;
    useLangyStore.getState().resetForProject(PROJECT_ID);
    useLangyStore.setState({
      isOpen: true,
      scopeAnnounced: false,
      activeConversationId: CONVERSATION_ID,
      activeConversationScope: {
        userId: null,
        organizationId: null,
        projectId: PROJECT_ID,
      },
      turnPhase: "idle",
      backendSawTurnInFlight: false,
      // No pending user selection: that effect owns the engine and would push
      // the (empty) durable history into it on mount, which is not the state
      // this file is about.
      historyLoadConversationId: null,
    });
    render(<LangySidecar />, { wrapper: Wrapper });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a streamed token appends to the answer below it", () => {
    it("hands the memo'd message the very same choices timeline", async () => {
      await waitFor(() => expect(lastPropsFor("m-question")).toBeTruthy());
      const before = lastPropsFor("m-question")!;

      streamToken("Looking at your");

      // The panel really did re-render the whole column for that token.
      await waitFor(() => expect(lastPropsFor("m-question")).not.toBe(before));
      const after = lastPropsFor("m-question")!;

      // The timeline is rebuilt from the whole message list on every render, so
      // without the value-keyed ref this is a new array per token — a changed
      // prop on every message in the column.
      expect(after.choicesTimeline).toBe(before.choicesTimeline);
      expect(after.choicesTimeline).toHaveLength(3);
    });

    it("hands it the very same choice handler", async () => {
      await waitFor(() => expect(lastPropsFor("m-question")).toBeTruthy());
      const before = lastPropsFor("m-question")!;

      streamToken("Looking at your traces");

      await waitFor(() => expect(lastPropsFor("m-question")).not.toBe(before));
      const after = lastPropsFor("m-question")!;

      expect(after.onChoiceSelect).toBe(before.onChoiceSelect);
      expect(after.onChoiceSelect).toBeTypeOf("function");
    });
  });
});
