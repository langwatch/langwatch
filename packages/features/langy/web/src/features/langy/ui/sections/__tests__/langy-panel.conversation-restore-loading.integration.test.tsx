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
 * Boundary mocks only: the project/feature-flag context, the Langy API surface
 * (an in-memory tRPC-shaped double whose history read is held open on
 * purpose), and `@ai-sdk/react`. The panel, the store and the empty/skeleton
 * branch are all real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";
const CONVERSATION_ID = "conv-remembered";

/** How many messages the recents list says the remembered conversation holds. */
const RESTORED_MESSAGE_COUNT = 6;

// The auto-resizing textarea (Ark's field-textarea) reaches for
// ResizeObserver on mount, which jsdom does not implement.
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

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ currentDrawer: null }),
}));

// Cuts the model picker's dependency chain onto the (unrelated) workflow
// studio host — this test is about the restore-loading placeholder, not the
// model picker.
vi.mock("../../elements/langy-model-pill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

vi.mock("../../../../../behavior/langy-api", async () => {
  const { createTrpcUtils, idleQuery, modelProviderRouter, withFallback } =
    await import("../../../__tests__/support/langy-api-mock");
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
      isFetching: enabled && !settled,
      isPlaceholderData: false,
      isFetched: settled,
      isSuccess: settled,
      isError: false,
      error: null,
      refetch: () => Promise.resolve(),
    };
  };

  const trpcUtils = createTrpcUtils();

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
      stopTurn: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: modelProviderRouter(),
    virtualKeys: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
    },
  };

  return { api: withFallback(explicitApi), trpcClient: {} };
});

import { LangySidecar } from "../langy-panel";
import { LangyProvider } from "../langy-context";
import { useLangyStore } from "../../../../../index";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host";

/**
 * The host port, stubbed for a panel that is already open on a remembered
 * conversation. Route reading and navigation are inert: nothing in this
 * scenario reads the address bar.
 */
class FakeLangyHost extends LangyHostPort {
  project() {
    return { id: PROJECT_ID, slug: "demo", name: "demo" };
  }
  organization() {
    return { id: "org-1" };
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
    return { params: {}, query: {}, pathname: "/demo/traces" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyHostProvider value={new FakeLangyHost()}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
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
        await waitFor(() => expect(document.body.textContent).toContain("the remembered question"));
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
