/**
 * @vitest-environment jsdom
 *
 * Coming back to a conversation that still has to load.
 *
 * The panel remembers WHICH conversation was open, so from the instant it
 * mounts it knows there is one — before the history read lands. It used to
 * spend that window rendering the empty state's invitation ("Hey, I'm Langy!"
 * plus starter suggestions) over a conversation the reader had already had,
 * then swap it for the real thread a beat later. Restoring is not starting
 * fresh, and this pins that it no longer looks like it.
 *
 * Spec: specs/langy/langy-navigation-persistence.feature
 *
 * Boundary mocks only: the project context, `~/utils/api` (an in-memory tRPC
 * surface whose history read is held open on purpose), and `@ai-sdk/react`.
 * The panel, the store and the empty/skeleton branch are all real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";
const CONVERSATION_ID = "conv-remembered";

/** How many messages the recents list says the remembered conversation holds. */
const RESTORED_MESSAGE_COUNT = 6;

/**
 * The history read, held open. `resolveHistory()` is what "the snapshot
 * arrived" means — until it is called the query reports loading, which is
 * exactly the window under test.
 */
const historyListeners = new Set<() => void>();
const historyState = { version: 0, resolved: false };
const resolveHistory = () =>
  act(() => {
    historyState.resolved = true;
    historyState.version++;
    historyListeners.forEach((notify) => notify());
  });

/**
 * The chat engine, modelled as real state: the panel applies the loaded
 * history through `setMessages`, so an inert mock would show an empty thread
 * forever and the "placeholder gives way to the conversation" assertion could
 * never be true.
 */
interface EngineMessage {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string }>;
}
const engine: {
  messages: EngineMessage[];
  version: number;
  listeners: Set<() => void>;
} = { messages: [], version: 0, listeners: new Set() };
const notifyEngine = () => {
  engine.version++;
  engine.listeners.forEach((notify) => notify());
};

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
        status: "ready",
        error: undefined,
        sendMessage: vi.fn(),
        setMessages: (messages: EngineMessage[]) => {
          engine.messages = messages;
          notifyEngine();
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

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("~/utils/api", async () => {
  const React = await import("react");

  const useHeldHistoryQuery = (enabled: boolean) => {
    React.useSyncExternalStore(
      (notify: () => void) => {
        historyListeners.add(notify);
        return () => historyListeners.delete(notify);
      },
      () => historyState.version,
      () => historyState.version,
    );
    const settled = enabled && historyState.resolved;
    return {
      data: settled
        ? {
            messages: [
              {
                id: "m1",
                role: "user" as const,
                parts: [{ type: "text", text: "the remembered question" }],
                createdAtMs: 0,
              },
            ],
            lastError: null,
            isTurnInFlight: false,
            inFlightTurnId: null,
            shouldAskFeedback: false,
            eventCursor: null,
            currentTurnId: null,
          }
        : undefined,
      isLoading: enabled && !settled,
      isInitialLoading: enabled && !settled,
      isFetching: enabled && !settled,
      isPreviousData: false,
      isFetched: settled,
      isSuccess: settled,
      isError: false,
      error: null,
      refetch: () => Promise.resolve(),
    };
  };

  const trpcUtils = {
    langy: {
      list: {
        getData: () => undefined,
        setData: () => undefined,
        getInfiniteData: () => undefined,
        setInfiniteData: () => undefined,
        cancel: () => Promise.resolve(),
        invalidate: () => Promise.resolve(),
      },
      messages: { invalidate: () => Promise.resolve() },
      detail: { setData: () => undefined },
    },
    langyGithub: { getInstallStatus: { invalidate: () => Promise.resolve() } },
  };

  const idleQuery = () => ({
    data: undefined,
    isLoading: false,
    isInitialLoading: false,
    isFetching: false,
    isPreviousData: false,
    isFetched: true,
    isError: false,
    error: null,
    refetch: () => Promise.resolve(),
  });
  const noopMutation = () => ({
    mutate: () => undefined,
    mutateAsync: () => Promise.resolve(),
    isPending: false,
  });
  const routerProxy: unknown = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "useQuery" || prop === "useInfiniteQuery") return idleQuery;
        if (prop === "useMutation") return noopMutation;
        if (prop === "useSubscription") return () => undefined;
        return routerProxy;
      },
    },
  );
  const withFallback = (explicit: Record<string, unknown>) =>
    new Proxy(explicit, {
      get: (target, prop) =>
        prop in target ? target[prop as string] : (routerProxy as never),
    });

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      // The recents list is what already knows how big the remembered
      // conversation is — the panel's whole basis for sizing before the
      // messages land.
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: {
            pages: [
              {
                items: [
                  {
                    id: CONVERSATION_ID,
                    title: "the remembered conversation",
                    isShared: false,
                    isOwn: true,
                    messageCount: RESTORED_MESSAGE_COUNT,
                    lastActivityAtMs: 0,
                  },
                ],
                nextCursor: null,
              },
            ],
            pageParams: [],
          },
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
        useQuery: (
          input: { projectId: string; conversationId: string },
          opts?: { enabled?: boolean },
        ) => useHeldHistoryQuery(opts?.enabled !== false && !!input.conversationId),
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
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: { providers: [] }, isLoading: false }),
      },
    },
    virtualKeys: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    langyGithub: {
      getInstallStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
    },
  };

  return { api: withFallback(explicitApi) };
});

import { LangySidecar } from "../components/LangyPanel";
import { LangyProvider } from "../LangyContext";
import { useLangyStore } from "../stores/langyStore";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

/** Mount the way a reload does: the store still points at the conversation. */
function renderRestoringPanel({ remembered }: { remembered: boolean }) {
  useLangyStore.setState({
    isOpen: true,
    scopeAnnounced: false,
    activeConversationId: remembered ? CONVERSATION_ID : null,
    activeConversationScope: {
      userId: null,
      organizationId: null,
      projectId: PROJECT_ID,
    },
  });
  return render(<LangySidecar />, { wrapper: Wrapper });
}

const skeleton = () => screen.queryByTestId("langy-conversation-skeleton");
const invitation = () => screen.queryByTestId("langy-empty-state");

describe("reopening a conversation that has not loaded yet", () => {
  beforeEach(() => {
    historyState.version = 0;
    historyState.resolved = false;
    engine.messages = [];
    engine.version = 0;
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the panel remembered a conversation", () => {
    describe("when its messages have not arrived", () => {
      it("holds the column in the shape of a conversation", async () => {
        renderRestoringPanel({ remembered: true });

        await waitFor(() => expect(skeleton()).toBeTruthy());
      });

      /** @scenario A conversation that is still loading never shows the empty invitation */
      it("never offers the invitation meant for a new chat", async () => {
        renderRestoringPanel({ remembered: true });

        await waitFor(() => expect(skeleton()).toBeTruthy());
        expect(invitation()).toBeNull();
      });
    });

    describe("when the messages arrive", () => {
      it("replaces the placeholder with the conversation itself", async () => {
        renderRestoringPanel({ remembered: true });
        await waitFor(() => expect(skeleton()).toBeTruthy());

        resolveHistory();

        // The reveal animation splits a message into per-character spans, so
        // the question is read off the rendered text rather than matched as
        // one node.
        await waitFor(() =>
          expect(document.body.textContent).toContain(
            "the remembered question",
          ),
        );
        expect(skeleton()).toBeNull();
        expect(invitation()).toBeNull();
      });
    });
  });

  describe("given no conversation was remembered", () => {
    // A genuinely new chat is what the invitation is FOR — the fix must not
    // have swapped one wrong state for another.
    it("offers the invitation, with no placeholder", async () => {
      renderRestoringPanel({ remembered: false });

      await waitFor(() => expect(invitation()).toBeTruthy());
      expect(skeleton()).toBeNull();
    });
  });
});
