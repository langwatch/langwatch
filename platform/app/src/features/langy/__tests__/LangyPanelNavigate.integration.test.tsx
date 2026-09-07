/**
 * @vitest-environment jsdom
 *
 * Agent-driven navigation, at the panel: a `navigate` entry on the live turn
 * stream must move the browser through the SPA router (never a full reload),
 * exactly once per instruction, and only when nothing in the turn actually
 * asked to navigate. Boundary mocks mirror
 * LangyConversationThreading.integration.test.tsx (useChat captures the real
 * transport; the tRPC client is a hand-rolled double at the network
 * boundary) plus a router mock so `router.push` is observable.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock, historyRef, refetchHistoryMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  // The durable transcript snapshot `langy.messages` hands the panel. Mutable
  // so a test can move it the way a refetch would.
  historyRef: {
    current: undefined as
      | {
          messages: Array<{ id: string; role: string; parts: unknown[] }>;
          isTurnInFlight: boolean;
          inFlightTurnId: string | null;
          currentTurnId: string | null;
        }
      | undefined,
  },
  refetchHistoryMock: vi.fn(),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    query: {},
    pathname: "/[project]/simulations",
    asPath: "/demo/simulations",
    isReady: true,
  }),
}));

const projectRef = {
  current: { id: "project-demo", slug: "demo" } as {
    id: string;
    slug: string;
  } | null,
};

// The guided tour host reads the guided onboarding state over tRPC; this
// suite covers the panel, not the tour.
vi.mock("~/features/guided-onboarding/tour/GuidedOnboardingHost", () => ({
  GuidedOnboardingHost: () => null,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: projectRef.current }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

// LangySidecar reads a feature flag (peek-dock) at mount. Mock the hook
// directly, matching the sibling panel tests.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

const chatRef = {
  messages: [] as Array<{
    id: string;
    role: string;
    parts: Array<{ type: string; text: string }>;
  }>,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  setMessages: vi.fn(),
  resumeStream: vi.fn(),
};

const transportRef = {
  current: null as ChatTransport<UIMessage> | null,
};

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { transport: ChatTransport<UIMessage> }) => {
    transportRef.current = options.transport;
    return {
      messages: chatRef.messages,
      sendMessage: chatRef.sendMessage,
      stop: chatRef.stop,
      status: chatRef.status,
      setMessages: chatRef.setMessages,
      resumeStream: chatRef.resumeStream,
    };
  },
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

const mutation = vi.fn();
const subscription = vi.fn(
  (_path: string, _input: unknown, _options: unknown) => ({
    unsubscribe: vi.fn(),
  }),
);

vi.mock("~/utils/api", () => ({
  trpcClient: {
    langy: {
      createConversation: {
        mutate: (input: unknown) => mutation("langy.createConversation", input),
      },
      continueConversation: {
        mutate: (input: unknown) =>
          mutation("langy.continueConversation", input),
      },
      onTurnStream: {
        subscribe: (input: unknown, options: unknown) =>
          subscription("langy.onTurnStream", input, options),
      },
    },
  },
  api: {
    onboarding: {
      attachConversation: {
        useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
      },
    },
    useUtils: () => ({
      langy: {
        list: { invalidate: () => Promise.resolve() },
        messages: { invalidate: () => Promise.resolve() },
      },
      github: {
        getConnectionStatus: { invalidate: () => Promise.resolve() },
      },
    }),
    useContext: () => ({
      langy: {
        list: {
          getInfiniteData: () => undefined,
          setInfiniteData: () => undefined,
          cancel: () => Promise.resolve(),
          invalidate: () => Promise.resolve(),
        },
        messages: { invalidate: () => Promise.resolve() },
        detail: { setData: () => undefined },
      },
    }),
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
    },
    langy: {
      messages: {
        useQuery: () => ({
          data: historyRef.current,
          isLoading: false,
          isFetching: false,
          isError: false,
          isSuccess: !!historyRef.current,
          error: null,
          refetch: () => {
            refetchHistoryMock();
            return Promise.resolve();
          },
        }),
      },
      modelsAllowed: {
        useQuery: () => ({
          data: { modelsAllowed: null },
          isLoading: false,
          isError: false,
        }),
      },
      onConversationUpdate: { useSubscription: () => undefined },
      warmWorker: {
        useMutation: () => ({ mutate: () => undefined }),
      },
      // ADR-129: the panel reads the shared folder and answers a
      // question card's wait; neither is what these tests drive.
      getLocalWorkspace: {
        useQuery: () => ({ data: undefined, refetch: () => undefined }),
      },
      localRecord: {
        useQuery: () => ({ data: undefined, refetch: () => undefined }),
      },
      answerQuestion: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
      stopTurn: {
        useMutation: () => ({
          mutate: () => undefined,
          mutateAsync: () => Promise.resolve(),
          isPending: false,
        }),
      },
      deleteConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      renameConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      forkConversation: {
        useMutation: () => ({
          mutateAsync: () => Promise.resolve({ id: "forked" }),
        }),
      },
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: [], nextCursor: null }] },
          isLoading: false,
          isFetching: false,
          isPlaceholderData: false,
          isFetched: true,
          isError: false,
          error: null,
          refetch: () => Promise.resolve(),
          fetchNextPage: () => Promise.resolve(),
          hasNextPage: false,
          isFetchingNextPage: false,
        }),
      },
    },
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
    // useProjectReach (mounted by LangySidecar) reads the onboarding checks.
    integrationsChecks: {
      getCheckStatus: {
        useQuery: () => ({
          data: {
            firstMessage: true,
            onlineEvaluations: 1,
            simulations: 1,
            datasets: 1,
          },
          isLoading: false,
        }),
      },
    },
    ops: {
      getScope: {
        useQuery: () => ({
          data: { scope: { kind: "none" } },
          isLoading: false,
        }),
      },
    },
  },
}));

import { initialLangyTurnProjection } from "@langwatch/langy";
import { LangySidecar } from "../components/LangyPanel";
import { LangyProvider } from "../LangyContext";
import { useLangyStore } from "../stores/langyStore";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

function renderPanel() {
  return render(<LangySidecar />, { wrapper: Wrapper });
}

const sendOptions = {
  messages: [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "show me a run" }],
    },
  ],
} as unknown as Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];

beforeEach(() => {
  projectRef.current = { id: "project-demo", slug: "demo" };
  chatRef.messages = [];
  chatRef.status = "ready";
  chatRef.sendMessage.mockReset();
  chatRef.setMessages.mockReset();
  chatRef.resumeStream.mockReset();
  transportRef.current = null;
  mutation.mockReset();
  mutation.mockResolvedValue({ conversationId: "conv-1", turnId: "turn-1" });
  subscription.mockClear();
  pushMock.mockClear();
  historyRef.current = undefined;
  refetchHistoryMock.mockClear();
  window.localStorage.clear();
  useLangyStore.setState({
    isOpen: true,
    activeConversationId: null,
    historyLoadConversationId: null,
    activeTurnId: null,
    settledTurnId: null,
    turnPhase: "idle",
    turnProjection: initialLangyTurnProjection,
  });
});

afterEach(() => {
  cleanup();
});

/** The `onData` handler the transport most recently handed a subscription. */
function latestOnData(): (entry: unknown) => void {
  const call = subscription.mock.calls.at(-1)!;
  const opts = call[2] as { onData: (entry: unknown) => void };
  return opts.onData;
}

describe("Feature: Langy opens the resource it surfaced in the browser", () => {
  describe("Rule: Langy navigates only when I asked to be taken somewhere", () => {
    describe("given I ask Langy to show me one of the scenario runs", () => {
      /** @scenario "Asking Langy to show a scenario run opens it in place" */
      it("the browser lands on that run's detail view via the SPA router", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
        });

        expect(pushMock).toHaveBeenCalledWith(
          "/demo/simulations/set_1/batch_1?openRun=run_1",
        );
        // …and the move tore nothing down: the panel is still open with the
        // SAME live subscription — no remount, no re-subscribe, conversation
        // intact.
        expect(useLangyStore.getState().isOpen).toBe(true);
        expect(subscription).toHaveBeenCalledTimes(1);
        const { unsubscribe } = subscription.mock.results.at(-1)!.value as {
          unsubscribe: ReturnType<typeof vi.fn>;
        };
        expect(unsubscribe).not.toHaveBeenCalled();
      });
    });

    describe("given I ask Langy to list recent scenario runs (no open intent)", () => {
      /** @scenario "Surfacing resources without an open intent does not navigate" */
      it("the browser stays on the page I was on — no navigate entry, no push", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({ type: "delta", text: "Here are your runs." });
          latestOnData()({ type: "end" });
        });

        expect(pushMock).not.toHaveBeenCalled();
      });
    });

    describe("given Langy could not look up the resource with my own access", () => {
      /** @scenario "Langy only navigates to resources reachable with my own access" */
      it("the browser does not navigate, and the answer still renders", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        // The denied lookup arrives as a failed tool call and an apologetic
        // answer — and NO navigate entry: the relay only caches links from
        // lookups the viewer's own access could complete (pinned by the
        // failed-lookup and forged-stdout tests in
        // langyTurnRelay.unit.test.ts), so there is nothing to navigate with.
        act(() => {
          latestOnData()({
            type: "tool",
            id: "call-1",
            name: "bash",
            phase: "end",
            isError: true,
            output: "Error: 403 — you do not have access to this resource",
          });
          latestOnData()({
            type: "delta",
            text: "I couldn't open that — your account can't see it.",
          });
          latestOnData()({ type: "end" });
        });

        expect(pushMock).not.toHaveBeenCalled();
        expect(useLangyStore.getState().isOpen).toBe(true);
      });
    });
  });

  describe("Rule: Agent navigation is SPA-safe and never tears the panel down", () => {
    describe("when Langy navigates me to a resource it surfaced", () => {
      /** @scenario "An agent-driven navigation keeps the panel and conversation mounted" */
      it("keeps the same live subscription mounted — the in-flight response keeps streaming", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({ type: "delta", text: "Here's the run: " });
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
          // The turn keeps going right through the navigate — no exception,
          // no early close, and the subscription is exactly the one opened
          // (the panel/transport never remounted).
          latestOnData()({ type: "delta", text: "it passed." });
          latestOnData()({ type: "end" });
        });

        expect(pushMock).toHaveBeenCalledTimes(1);
        expect(subscription).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("Rule: Navigation is a live-edge instruction, fired at most once", () => {
    describe("given a turn's live stream is replayed after a reconnect", () => {
      it("navigates the browser at most once for the same instruction", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
          // A redelivered tail hands the client the exact same entry again.
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
        });

        expect(pushMock).toHaveBeenCalledTimes(1);
      });
    });

    describe("given a NEW turn starts", () => {
      it("clears the dedup so the same destination can be navigated to again", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());

        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));
        act(() => {
          latestOnData()({ type: "navigate", href: "/demo/simulations" });
        });
        expect(pushMock).toHaveBeenCalledTimes(1);

        mutation.mockResolvedValueOnce({
          conversationId: "conv-1",
          turnId: "turn-2",
        });
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(2));
        act(() => {
          latestOnData()({ type: "navigate", href: "/demo/simulations" });
        });

        expect(pushMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("Rule: a turn this tab did not start reattaches to its stream", () => {
    // The durable fold hands a tab the turn it did not dispatch (the server
    // starts one when the shared folder connects; a refresh mid-turn lands
    // here too), but navigate is a live-only entry: it reaches a tab through
    // the turn stream alone. Adopting the turn must open that stream.
    const adoptedTurnHistory = [
      {
        id: "message-1",
        role: "user",
        parts: [{ type: "text", text: "Local folder connected" }],
      },
    ];

    function adoptTurnFromDurableRecord(turnId: string) {
      act(() => {
        useLangyStore.getState().seedTurnProjection({
          cursor: { acceptedAt: 1, eventId: "event-1" },
          currentTurnId: turnId,
        });
      });
    }

    /** @scenario "A turn started by the shared folder connecting reaches the open tab" */
    it("resumes the adopted turn and routes its navigate through the SPA router", async () => {
      useLangyStore.setState({ activeConversationId: "conv-1" });
      chatRef.messages = adoptedTurnHistory;
      renderPanel();
      await waitFor(() => expect(transportRef.current).not.toBeNull());
      expect(chatRef.resumeStream).not.toHaveBeenCalled();

      adoptTurnFromDurableRecord("turn-9");

      await waitFor(() =>
        expect(chatRef.resumeStream).toHaveBeenCalledTimes(1),
      );

      // useChat's resume asks the transport to reconnect; the transport
      // subscribes to the adopted turn, not to one of its own.
      let stream: ReadableStream | null = null;
      await act(async () => {
        stream = await transportRef.current!.reconnectToStream({
          chatId: "chat-1",
        });
      });
      expect(stream).not.toBeNull();
      expect(subscription).toHaveBeenCalledTimes(1);
      expect(subscription.mock.calls[0]![1]).toEqual({
        projectId: "project-demo",
        conversationId: "conv-1",
        turnId: "turn-9",
      });

      act(() => {
        latestOnData()({
          type: "navigate",
          href: "/demo/simulations/set_1/batch_1?openRun=run_1",
        });
      });
      expect(pushMock).toHaveBeenCalledWith(
        "/demo/simulations/set_1/batch_1?openRun=run_1",
      );
    });

    /** @scenario "A turn in flight resumes after a page refresh" */
    it("resumes once per adopted turn, and never the turn this tab sent itself", async () => {
      useLangyStore.setState({ activeConversationId: "conv-1" });
      chatRef.messages = adoptedTurnHistory;
      renderPanel();
      await waitFor(() => expect(transportRef.current).not.toBeNull());

      adoptTurnFromDurableRecord("turn-9");
      await waitFor(() =>
        expect(chatRef.resumeStream).toHaveBeenCalledTimes(1),
      );

      // The same durable turn re-asserted (a refetch, a fresher cursor) is not
      // a second resume.
      act(() => {
        useLangyStore.getState().seedTurnProjection({
          cursor: { acceptedAt: 2, eventId: "event-2" },
          currentTurnId: "turn-9",
        });
      });
      expect(chatRef.resumeStream).toHaveBeenCalledTimes(1);

      // A turn this tab dispatches has its stream from the send itself.
      act(() => {
        useLangyStore.getState().settleTurn("turn-9");
      });
      mutation.mockResolvedValueOnce({
        conversationId: "conv-1",
        turnId: "turn-10",
      });
      await act(async () => {
        await transportRef.current!.sendMessages(sendOptions);
      });
      await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));
      expect(useLangyStore.getState().activeTurnId).toBe("turn-10");
      expect(chatRef.resumeStream).toHaveBeenCalledTimes(1);
    });

    // The panel had answered a turn of its own before the folder connected, so
    // the engine's last message is that answer and the transcript snapshot
    // predates the new turn entirely. Nothing refreshes that snapshot on its
    // own — the freshness signal drives the event fold, and the transcript's
    // in-flight poll is armed by a flag the stale snapshot does not carry — so
    // the panel used to sit on the previous turn's transcript for the whole
    // run, never ready to resume and never subscribed, and every live-only
    // entry the turn issued (both of the take's navigates) reached nobody.
    /** @scenario "A folder-connected turn reaches a tab that already answered one" */
    it("re-reads the transcript, then resumes and navigates", async () => {
      useLangyStore.setState({ activeConversationId: "conv-1" });
      const answered = [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "set up my agent" }],
        },
        {
          id: "message-2",
          role: "assistant",
          parts: [{ type: "text", text: "Can I access your code?" }],
        },
      ];
      historyRef.current = {
        messages: answered,
        isTurnInFlight: false,
        inFlightTurnId: null,
        currentTurnId: null,
      };
      chatRef.messages = answered as typeof chatRef.messages;
      const { rerender } = renderPanel();
      await waitFor(() => expect(transportRef.current).not.toBeNull());
      refetchHistoryMock.mockClear();

      adoptTurnFromDurableRecord("turn-9");

      // The fold is ahead of the transcript: read it again.
      await waitFor(() => expect(refetchHistoryMock).toHaveBeenCalledTimes(1));

      // …which lands the new turn's own user message.
      const withFolderNotice = [
        ...answered,
        {
          id: "message-3",
          role: "user",
          parts: [{ type: "text", text: "Local folder connected" }],
        },
      ];
      historyRef.current = {
        messages: withFolderNotice,
        isTurnInFlight: true,
        inFlightTurnId: "turn-9",
        currentTurnId: "turn-9",
      };
      await act(async () => {
        rerender(<LangySidecar />);
      });
      await waitFor(() => expect(chatRef.setMessages).toHaveBeenCalled());

      // The engine takes it, which is what readies the resume.
      chatRef.messages = withFolderNotice as typeof chatRef.messages;
      await act(async () => {
        rerender(<LangySidecar />);
      });
      await waitFor(() =>
        expect(chatRef.resumeStream).toHaveBeenCalledTimes(1),
      );

      await act(async () => {
        await transportRef.current!.reconnectToStream({ chatId: "chat-1" });
      });
      expect(subscription.mock.calls[0]![1]).toEqual({
        projectId: "project-demo",
        conversationId: "conv-1",
        turnId: "turn-9",
      });

      act(() => {
        latestOnData()({
          type: "navigate",
          href: "/demo/simulations/set_1/batch_1?openRun=run_1",
        });
      });
      expect(pushMock).toHaveBeenCalledWith(
        "/demo/simulations/set_1/batch_1?openRun=run_1",
      );

      // One read per adopted turn, not one per render.
      expect(refetchHistoryMock).toHaveBeenCalledTimes(1);
    });

    it("reconnects to nothing when no adopted turn is in flight", async () => {
      renderPanel();
      await waitFor(() => expect(transportRef.current).not.toBeNull());
      await expect(
        transportRef.current!.reconnectToStream({ chatId: "chat-1" }),
      ).resolves.toBeNull();
      expect(subscription).not.toHaveBeenCalled();
    });
  });

  describe("Rule: a navigate entry that is not a same-app path never moves the browser", () => {
    // The relay only ever resolves same-origin relative hrefs, but the panel's
    // `isInternalHref` guard is the last line of defence before `router.push`
    // runs — a redelivered/forged entry must not push. Feeding a real
    // off-site-in-disguise href locks that guard: delete it and this goes red.
    it.each([
      ["a protocol-relative host", "//evil.example.com/steal"],
      ["a backslash-disguised host", "/\\evil.example.com"],
      ["an absolute off-site url", "https://evil.example.com/steal"],
    ])("does not push for %s", async (_label, href) => {
      renderPanel();
      await waitFor(() => expect(transportRef.current).not.toBeNull());
      await act(async () => {
        await transportRef.current!.sendMessages(sendOptions);
      });
      await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

      act(() => {
        latestOnData()({ type: "navigate", href });
      });

      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
