/**
 * @vitest-environment jsdom
 * A send whose conversation is named only after the panel moved to another project (or to
 * the personal workspace) stays with the project it was sent from. Boundary mocks: the tRPC
 * client, the router and the feature flag.
 * @see specs/langy/langy-context-awareness.feature
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startTurn = vi.fn<(input: unknown) => Promise<{ conversationId: string; turnId: string }>>();
const subscribe = vi.fn((_input: unknown, _handlers: unknown) => ({ unsubscribe: vi.fn() }));
const client = {
  langy: {
    createConversation: { mutate: (input: unknown) => startTurn(input) },
    continueConversation: { mutate: (input: unknown) => startTurn(input) },
    onTurnStream: { subscribe },
  },
};

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({
      client,
      langy: { messages: { invalidate: vi.fn() } },
      dashboardWidgets: { list: { invalidate: vi.fn() } },
      graphs: { getAll: { invalidate: vi.fn() } },
    }),
  },
}));
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useLangyPanelTransport } from "../panel/use-langy-panel-transport.ts";
import { useLangyChatEngine } from "../use-langy-chat-engine.ts";

const langy = () => useLangyStore.getState();

const PROJECT = { userId: "user-1", organizationId: "org-1", projectId: "project-team" };
const PERSONAL = { ...PROJECT, projectId: "project-personal" };
const OTHER_ORGANISATION = { ...PROJECT, organizationId: "org-2" };
const OTHER_USER = { ...PROJECT, userId: "user-2" };

type SendOptions = Parameters<
  ReturnType<typeof useLangyPanelTransport>["transport"]["sendMessages"]
>[0];

const SEND: SendOptions = {
  trigger: "submit-message",
  chatId: "chat-1",
  messageId: undefined,
  abortSignal: undefined,
  messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
};

/** Send from `from`, and hand back the server's answer to release whenever the test says. */
function sendFrom(from: typeof PROJECT) {
  const { result } = renderHook(() =>
    useLangyPanelTransport({ projectId: from.projectId, organizationId: from.organizationId }),
  );
  const { transport, refs } = result.current;
  const named = vi.fn();
  refs.kickoffNamedRef.current = named;
  refs.turnContextRef.current = {
    projectId: from.projectId,
    conversationId: null,
    pendingConversationId: null,
  };
  let answer: (ids: { conversationId: string; turnId: string }) => void = () => undefined;
  startTurn.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  langy().resetForScope(from);
  langy().beginSend();
  const stream = transport.sendMessages(SEND);
  return { stream, named, nameConversation: answer };
}

async function chunksOf(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

beforeEach(() => {
  useLangyStore.setState({ activeConversationScope: null, scopeAnnounced: false });
  langy().resetForScope({ userId: null, organizationId: null, projectId: null });
});

afterEach(() => {
  startTurn.mockReset();
  subscribe.mockClear();
});

describe("Langy send outlived by a change of scope", () => {
  describe.each([
    { from: PROJECT, to: PERSONAL, move: "from a project to the personal workspace" },
    { from: PERSONAL, to: PROJECT, move: "from the personal workspace to a project" },
    { from: PROJECT, to: OTHER_ORGANISATION, move: "to another organisation on the same project" },
    { from: PROJECT, to: OTHER_USER, move: "to another user on the same project" },
  ])("given a message sent $move before Langy named its conversation", ({ from, to }) => {
    /** @scenario A message still on its way stays where I sent it */
    it("leaves the panel on nothing, with the composer free to send", async () => {
      const { stream, named, nameConversation } = sendFrom(from);

      langy().resetForScope(to);
      nameConversation({ conversationId: "conv-elsewhere", turnId: "turn-elsewhere" });

      expect(await chunksOf(await stream)).toEqual([]);
      expect(langy().activeConversationId).toBeNull();
      expect(langy().activeTurnId).toBeNull();
      expect(langy().turnPhase).toBe("idle");
      // Never attaching to the turn is what keeps the not-found answer off the panel.
      expect(subscribe).not.toHaveBeenCalled();
      // The guided onboarding still records the conversation its kickoff made.
      expect(named).toHaveBeenCalledWith("conv-elsewhere");
    });
  });

  describe("given the panel's chat shows the question while it is on its way", () => {
    it("clears the question once it turns out to belong to the project it was sent from", async () => {
      const { result } = renderHook(() => {
        const sending = useLangyPanelTransport({
          projectId: PROJECT.projectId,
          organizationId: PROJECT.organizationId,
        });
        const engine = useLangyChatEngine({ transport: sending.transport });
        sending.refs.sendStrandedRef.current = () => engine.applyHistoryToEngine([]);
        return { refs: sending.refs, engine };
      });
      result.current.refs.turnContextRef.current = {
        projectId: PROJECT.projectId,
        conversationId: null,
        pendingConversationId: null,
      };
      let answer: (ids: { conversationId: string; turnId: string }) => void = () => undefined;
      startTurn.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
      langy().resetForScope(PROJECT);
      langy().beginSend();
      act(() => void result.current.engine.sendMessage({ text: "hi" }));
      await waitFor(() => expect(result.current.engine.messages).toHaveLength(1));

      langy().resetForScope(PERSONAL);
      await act(async () => answer({ conversationId: "conv-elsewhere", turnId: "t" }));

      await waitFor(() => expect(result.current.engine.status).toBe("ready"));
      expect(result.current.engine.messages).toEqual([]);
    });
  });

  describe("given the panel stays where the message was sent", () => {
    it("adopts the named conversation and attaches to its turn", async () => {
      const { stream, named, nameConversation } = sendFrom(PROJECT);

      langy().resetForScope(PROJECT);
      nameConversation({ conversationId: "conv-here", turnId: "turn-here" });
      await stream;

      expect(langy().activeConversationId).toBe("conv-here");
      expect(langy().activeTurnId).toBe("turn-here");
      expect(langy().turnPhase).toBe("active");
      expect(subscribe).toHaveBeenCalledWith(
        { projectId: PROJECT.projectId, conversationId: "conv-here", turnId: "turn-here" },
        expect.anything(),
      );
      expect(named).toHaveBeenCalledWith("conv-here");
    });
  });
});
