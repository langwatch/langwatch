/**
 * Agent-driven navigation, at the panel: a `navigate` entry on the live turn stream must move
 * the browser through the SPA router (never a full reload), only when the turn asked to navigate.
 * @vitest-environment jsdom
 * @see specs/langy/langy-agent-driven-navigation.feature
 * @see specs/langy/langy-frontend-realtime.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage } from "ai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

vi.mock("@langwatch/browser-trpc/workflow-api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    currentDrawer: undefined,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
}));

type ChatMessage = { id: string; role: string; parts: { type: string; text: string }[] };

const chatRef = {
  messages: [] as ChatMessage[],
  sendMessage: vi.fn(),
  stop: vi.fn(),
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  setMessages: vi.fn(),
  resumeStream: vi.fn(),
};

/** The durable transcript `langy.messages` answers, and the re-reads the panel asks for. */
const { historyRef, refetchHistoryMock } = vi.hoisted(() => ({
  historyRef: {
    current: undefined as
      | {
          messages: unknown[];
          isTurnInFlight: boolean;
          inFlightTurnId: string | null;
          currentTurnId: string | null;
        }
      | undefined,
  },
  refetchHistoryMock: vi.fn(),
}));

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
      error: undefined,
      clearError: vi.fn(),
      regenerate: vi.fn(),
      resumeStream: chatRef.resumeStream,
    };
  },
}));

const mutation = vi.fn();
const subscription = vi.fn((_input: unknown, _options: unknown) => ({
  unsubscribe: vi.fn(),
}));

vi.mock("../../../../../behavior/langy-api.ts", async () => {
  const { createTrpcUtils, idleQuery, withFallback } =
    await import("../../../__tests__/support/langy-api-mock.ts");

  const trpcUtils = createTrpcUtils();

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: { pages: [{ items: [], nextCursor: null }] },
          fetchNextPage: () => Promise.resolve(),
          hasNextPage: false,
          isFetchingNextPage: false,
        }),
      },
      modelsAllowed: {
        useQuery: () => ({
          data: { modelsAllowed: null },
          isLoading: false,
          isError: false,
        }),
      },
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
      stopTurn: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: { model: "openai/gpt-5-mini" },
          isLoading: false,
          isSuccess: true,
          isError: false,
          refetch: () => Promise.resolve(),
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: { providers: [] }, isLoading: false }),
      },
      setRoleAssignmentForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      setFeatureOverrideForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
    },
    virtualKeys: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
  };

  return {
    api: withFallback(explicitApi),
    trpcClient: {
      langy: {
        createConversation: {
          mutate: (input: unknown) => mutation("langy.createConversation", input),
        },
        continueConversation: {
          mutate: (input: unknown) => mutation("langy.continueConversation", input),
        },
        onTurnStream: {
          subscribe: (input: unknown, options: unknown) => subscription(input, options),
        },
      },
    },
  };
});

import { UiCapabilityContextProvider } from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { useLangyStore } from "@langwatch/langy-browser-kit";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";
import { LangyProvider } from "../../../../../ui/sections/langy-page-context.tsx";
import { LangySidecar } from "../langy-panel.tsx";

const PROJECT_ID = "project-demo";
const navigateMock = vi.fn();

class FakeLangyHost extends LangyHostApi {
  project() {
    return { id: PROJECT_ID, slug: "demo", name: "demo" };
  }
  organization() {
    return { id: "org-demo" };
  }
  team() {
    return { id: "team-1", isPersonal: false, members: [{ userId: "user-1" }] };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  featureFlag() {
    return false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/demo/experiments" };
  }
  setQuery() {}
  navigate(to: string) {
    navigateMock(to);
  }
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}
const host = new FakeLangyHost();

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <UiCapabilityContextProvider value={createUiCapabilitiesFromHost(host)}>
      <LangyHostProvider value={host}>
        <LangyProvider>{children}</LangyProvider>
      </LangyHostProvider>
    </UiCapabilityContextProvider>
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
  chatRef.messages = [];
  chatRef.status = "ready";
  chatRef.sendMessage.mockReset();
  chatRef.setMessages.mockReset();
  chatRef.resumeStream.mockReset();
  historyRef.current = undefined;
  refetchHistoryMock.mockClear();
  transportRef.current = null;
  mutation.mockReset();
  mutation.mockResolvedValue({ conversationId: "conv-1", turnId: "turn-1" });
  subscription.mockClear();
  navigateMock.mockClear();
  window.localStorage.clear();
  useLangyStore.setState({
    isOpen: true,
    activeConversationId: null,
    historyLoadConversationId: null,
  });
});

afterEach(() => {
  cleanup();
});

/** The `onData` handler the transport most recently handed a subscription. */
function latestOnData(): (entry: unknown) => void {
  const call = subscription.mock.calls.at(-1)!;
  const opts = call[1] as { onData: (entry: unknown) => void };
  return opts.onData;
}

async function startTurn() {
  const rendered = renderPanel();
  await waitFor(() => expect(transportRef.current).not.toBeNull());
  await act(async () => {
    await transportRef.current!.sendMessages(sendOptions);
  });
  await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));
  return rendered;
}

describe("Feature: Langy opens the resource it surfaced in the browser", () => {
  describe("when I asked Langy to take me somewhere", () => {
    describe("given I ask Langy to show me one of the scenario runs", () => {
      /** @scenario "Asking Langy to show a scenario run opens it in place" */
      it("lands the browser on that run's detail view via the SPA router", async () => {
        await startTurn();

        act(() => {
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
        });

        expect(navigateMock).toHaveBeenCalledWith("/demo/simulations/set_1/batch_1?openRun=run_1");
        // …and the move tore nothing down: the panel is still open with the
        // SAME live subscription — no remount, no re-subscribe.
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
      it("stays on the page I was on — no navigate entry, no push", async () => {
        await startTurn();

        act(() => {
          latestOnData()({ type: "delta", text: "Here are your runs." });
          latestOnData()({ type: "end" });
        });

        expect(navigateMock).not.toHaveBeenCalled();
      });
    });

    describe("given Langy could not look up the resource with my own access", () => {
      /** @scenario "Langy only navigates to resources reachable with my own access" */
      it("does not navigate, and the answer still renders", async () => {
        await startTurn();

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

        expect(navigateMock).not.toHaveBeenCalled();
        expect(useLangyStore.getState().isOpen).toBe(true);
      });
    });
  });

  describe("given navigation is agent-driven and must stay SPA-safe", () => {
    describe("when Langy navigates me to a resource it surfaced", () => {
      /** @scenario "An agent-driven navigation keeps the panel and conversation mounted" */
      it("keeps the same live subscription mounted — the in-flight response keeps streaming", async () => {
        await startTurn();

        act(() => {
          latestOnData()({ type: "delta", text: "Here's the run: " });
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
          latestOnData()({ type: "delta", text: "it passed." });
          latestOnData()({ type: "end" });
        });

        expect(navigateMock).toHaveBeenCalledTimes(1);
        expect(subscription).toHaveBeenCalledTimes(1);
      });
    });
  });
});

describe("Rule: a turn this tab did not start reattaches to its stream", () => {
  // The durable fold hands a tab the turn it did not dispatch (the server starts one when the
  // shared folder connects; a refresh mid-turn lands here too), but navigate is a live-only
  // entry: it reaches a tab through the turn stream alone. Adopting the turn must open it.
  beforeEach(() => {
    // A turn an earlier case dispatched and never settled would stay tracked, and a tab that
    // tracks a turn does not adopt another; each case starts from a fresh store.
    useLangyStore.setState(useLangyStore.getInitialState(), true);
    useLangyStore.setState({ isOpen: true });
  });

  const adoptedTurnHistory: ChatMessage[] = [
    { id: "message-1", role: "user", parts: [{ type: "text", text: "Local folder connected" }] },
  ];

  /** The panel announces its scope on mount, which starts over; the conversation opens after. */
  function openConversationAfterScopeAnnounced() {
    act(() => {
      useLangyStore.setState({ activeConversationId: "conv-1" });
    });
  }

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
    chatRef.messages = adoptedTurnHistory;
    renderPanel();
    await waitFor(() => expect(transportRef.current).not.toBeNull());
    openConversationAfterScopeAnnounced();
    expect(chatRef.resumeStream).not.toHaveBeenCalled();

    adoptTurnFromDurableRecord("turn-9");

    await waitFor(() => expect(chatRef.resumeStream).toHaveBeenCalledTimes(1));
    // useChat's resume asks the transport to reconnect; it subscribes to the adopted turn.
    let stream: ReadableStream | null = null;
    await act(async () => {
      stream = await transportRef.current!.reconnectToStream({ chatId: "chat-1" });
    });
    expect(stream).not.toBeNull();
    expect(subscription).toHaveBeenCalledTimes(1);
    expect(subscription.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      conversationId: "conv-1",
      turnId: "turn-9",
    });

    act(() => {
      latestOnData()({ type: "navigate", href: "/demo/simulations/set_1/batch_1?openRun=run_1" });
    });
    expect(navigateMock).toHaveBeenCalledWith("/demo/simulations/set_1/batch_1?openRun=run_1");
  });

  /** @scenario "A turn in flight resumes after a page refresh" */
  it("resumes once per adopted turn, and never the turn this tab sent itself", async () => {
    chatRef.messages = adoptedTurnHistory;
    renderPanel();
    await waitFor(() => expect(transportRef.current).not.toBeNull());
    openConversationAfterScopeAnnounced();

    adoptTurnFromDurableRecord("turn-9");
    await waitFor(() => expect(chatRef.resumeStream).toHaveBeenCalledTimes(1));

    // The same durable turn re-asserted (a refetch, a fresher cursor) is not a second resume.
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
    mutation.mockResolvedValueOnce({ conversationId: "conv-1", turnId: "turn-10" });
    await act(async () => {
      await transportRef.current!.sendMessages(sendOptions);
    });
    await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));
    expect(useLangyStore.getState().activeTurnId).toBe("turn-10");
    expect(chatRef.resumeStream).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A folder-connected turn reaches a tab that already answered one" */
  it("re-reads the transcript, then resumes and navigates", async () => {
    const answered: ChatMessage[] = [
      { id: "message-1", role: "user", parts: [{ type: "text", text: "set up my agent" }] },
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
    chatRef.messages = answered;
    const { rerender } = renderPanel();
    await waitFor(() => expect(transportRef.current).not.toBeNull());
    openConversationAfterScopeAnnounced();
    refetchHistoryMock.mockClear();

    adoptTurnFromDurableRecord("turn-9");

    // The fold is ahead of the transcript: read it again.
    await waitFor(() => expect(refetchHistoryMock).toHaveBeenCalledTimes(1));

    // …which lands the new turn's own user message.
    const withFolderNotice: ChatMessage[] = [
      ...answered,
      { id: "message-3", role: "user", parts: [{ type: "text", text: "Local folder connected" }] },
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
    chatRef.messages = withFolderNotice;
    await act(async () => {
      rerender(<LangySidecar />);
    });
    await waitFor(() => expect(chatRef.resumeStream).toHaveBeenCalledTimes(1));

    await act(async () => {
      await transportRef.current!.reconnectToStream({ chatId: "chat-1" });
    });
    expect(subscription.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      conversationId: "conv-1",
      turnId: "turn-9",
    });
    act(() => {
      latestOnData()({ type: "navigate", href: "/demo/simulations/set_1/batch_1?openRun=run_1" });
    });
    expect(navigateMock).toHaveBeenCalledWith("/demo/simulations/set_1/batch_1?openRun=run_1");

    // One read per adopted turn, not one per render.
    expect(refetchHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("reconnects to nothing when no adopted turn is in flight", async () => {
    renderPanel();
    await waitFor(() => expect(transportRef.current).not.toBeNull());
    await expect(transportRef.current!.reconnectToStream({ chatId: "chat-1" })).resolves.toBeNull();
    expect(subscription).not.toHaveBeenCalled();
  });
});
