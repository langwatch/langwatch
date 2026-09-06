/**
 * @vitest-environment jsdom
 *
 * A failed BACKGROUND read of `langy.messages` must not wipe the conversation.
 *
 * The panel polls the durable history every 3s for the whole of a turn, and
 * react-query keeps the last good `data` when a background refetch fails — only
 * `status` flips to error. The panel read `isError` alone, so a single API blip
 * mid-turn replaced the entire message column with "This conversation isn't
 * loading" while tokens were still streaming into messages that were sitting
 * right there.
 *
 * Both directions are pinned here: a stale read keeps the transcript (and says
 * so quietly), and a read that failed with NOTHING to show still owns the
 * column — a failure may never be quieter than a success.
 *
 * Boundary mocks only: the project context, `~/utils/api`, and `@ai-sdk/react`.
 * The panel, the store and the error branch are real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";
const CONVERSATION_ID = "conv-open";
const QUESTION = "what happened to my evals";

/** The history read's current shape, flipped by the tests. */
const historyState = {
  version: 0,
  /** Does the query hold rows at all? (false = the very first read failed) */
  hasData: true,
  /** Is the query reporting a failure right now? */
  errored: false,
  /** Does the durable transcript carry the question yet? */
  hasMessages: true,
  /** Does the fold say a turn is running for this conversation? */
  turnInFlight: false,
  /**
   * The handled domain code the read fails with, or null for a bare
   * infrastructure failure (no `data.error`, so no domain code at all).
   */
  errorCode: null as string | null,
};
const historyListeners = new Set<() => void>();
/** Every re-read of the conversation, so the stale line's retry can be seen. */
const historyRefetch = vi.fn(() => Promise.resolve());
const setHistory = (next: Partial<typeof historyState>) =>
  act(() => {
    Object.assign(historyState, next);
    historyState.version++;
    historyListeners.forEach((notify) => notify());
  });

/**
 * What the failed read hands the panel.
 *
 * A bare infrastructure failure carries no `data.error`, so the panel falls
 * back to its own generic "this conversation isn't loading" copy. A HANDLED
 * failure carries the domain code the server serialized, which is what
 * `readLangyTrpcError` reads and `explainLangyError` turns into a card — and
 * which of those two it is decides whether the failure may be demoted to the
 * quiet stale line at all.
 */
function historyReadError(): unknown {
  const code = historyState.errorCode;
  if (!code) return new Error("clickhouse unavailable");
  return Object.assign(new Error(code), {
    data: {
      error: {
        code,
        httpStatus: code === "langy_conversation_not_owned" ? 403 : 404,
        meta: {},
      },
    },
  });
}

/**
 * The chat engine, modelled as real state: the panel hydrates the durable
 * history into it, and it is that hydrated transcript the failed refetch used
 * to blow away.
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
  // The inert default for every router this suite does not speak for; only the
  // stale-read `messages.useQuery` below is this file's own business.
  const { createTrpcUtils, idleQuery, modelProviderRouter, withFallback } =
    await import("./support/langyApiMock");

  const useHistoryQuery = (enabled: boolean) => {
    React.useSyncExternalStore(
      (notify: () => void) => {
        historyListeners.add(notify);
        return () => historyListeners.delete(notify);
      },
      () => historyState.version,
      () => historyState.version,
    );
    // react-query's own behaviour on a failed BACKGROUND refetch: `data` is
    // retained from the last success, `status` becomes error. That coexistence
    // is the whole subject of this file.
    const turnId = historyState.turnInFlight ? "turn-live" : null;
    const data =
      enabled && historyState.hasData
        ? {
            messages: historyState.hasMessages
              ? [
                  {
                    id: "m1",
                    role: "user" as const,
                    parts: [{ type: "text", text: QUESTION }],
                    createdAtMs: 0,
                  },
                ]
              : [],
            lastError: null,
            isTurnInFlight: historyState.turnInFlight,
            inFlightTurnId: turnId,
            shouldAskFeedback: false,
            eventCursor: null,
            currentTurnId: turnId,
          }
        : undefined;
    return {
      data,
      isLoading: false,
      isFetching: false,
      isPlaceholderData: false,
      isFetched: true,
      isSuccess: enabled && !historyState.errored && !!data,
      isError: enabled && historyState.errored,
      error: historyState.errored ? historyReadError() : null,
      refetch: historyRefetch,
    };
  };

  const trpcUtils = createTrpcUtils();

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: {
            pages: [
              {
                items: [
                  {
                    id: CONVERSATION_ID,
                    title: "the open conversation",
                    isShared: false,
                    isOwn: true,
                    messageCount: 1,
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
        ) => useHistoryQuery(opts?.enabled !== false && !!input.conversationId),
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

function renderOpenPanel() {
  useLangyStore.setState({
    isOpen: true,
    scopeAnnounced: false,
    activeConversationId: CONVERSATION_ID,
    activeConversationScope: {
      userId: null,
      organizationId: null,
      projectId: PROJECT_ID,
    },
  });
  return render(<LangySidecar />, { wrapper: Wrapper });
}

const failureCard = () =>
  screen.queryByText(/this conversation isn't loading/i);
const staleNote = () => screen.queryByTestId("langy-history-stale");

describe("a failed read of an open conversation's history", () => {
  beforeEach(() => {
    historyState.version = 0;
    historyState.hasData = true;
    historyState.errored = false;
    historyState.hasMessages = true;
    historyState.turnInFlight = false;
    historyState.errorCode = null;
    historyRefetch.mockClear();
    engine.messages = [];
    engine.version = 0;
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject(PROJECT_ID);
    // The store is a module singleton, so the turn-phase machine outlives a
    // test. Park it at idle explicitly — a leaked `active` would make the
    // failure-card case below pass or fail for the wrong reason.
    useLangyStore.setState({
      turnPhase: "idle",
      backendSawTurnInFlight: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the conversation is already on screen", () => {
    describe("when a background refetch fails", () => {
      it("keeps the transcript instead of replacing it with a failure card", async () => {
        renderOpenPanel();
        await waitFor(() =>
          expect(document.body.textContent).toContain(QUESTION),
        );

        setHistory({ errored: true });

        expect(document.body.textContent).toContain(QUESTION);
        expect(failureCard()).toBeNull();
      });

      it("says the column is stale, quietly, rather than saying nothing", async () => {
        renderOpenPanel();
        await waitFor(() =>
          expect(document.body.textContent).toContain(QUESTION),
        );

        setHistory({ errored: true });

        await waitFor(() => expect(staleNote()).toBeTruthy());
        expect(staleNote()?.textContent).toMatch(/couldn't be refreshed/i);
      });

      it("drops the stale note again once the read recovers", async () => {
        renderOpenPanel();
        await waitFor(() =>
          expect(document.body.textContent).toContain(QUESTION),
        );
        setHistory({ errored: true });
        await waitFor(() => expect(staleNote()).toBeTruthy());

        setHistory({ errored: false });

        await waitFor(() => expect(staleNote()).toBeNull());
        expect(document.body.textContent).toContain(QUESTION);
      });
    });
  });

  describe("given the conversation is settled, so nothing will re-read it", () => {
    /**
     * The quiet line promises the reader that the messages below are the last
     * good ones and leaves it at that, which only holds while something is
     * coming back to clear it. The history read polls ONLY while the fold says
     * a turn is in flight, so on a settled conversation the notice is the end
     * of the road: no tick, no card, no action, nothing the reader can do.
     */
    describe("when a read of it fails", () => {
      it("offers a retry that reads the conversation again", async () => {
        renderOpenPanel();
        await waitFor(() =>
          expect(document.body.textContent).toContain(QUESTION),
        );

        setHistory({ errored: true });
        await waitFor(() => expect(staleNote()).toBeTruthy());

        historyRefetch.mockClear();
        fireEvent.click(
          within(staleNote()!).getByRole("button", { name: /try again/i }),
        );

        expect(historyRefetch).toHaveBeenCalled();
      });
    });
  });

  describe("given a turn is running, so the poll behind it will clear the notice", () => {
    describe("when the read fails mid-turn", () => {
      it("stays a quiet line, with nothing for the reader to press", async () => {
        historyState.turnInFlight = true;

        renderOpenPanel();
        await waitFor(() =>
          expect(document.body.textContent).toContain(QUESTION),
        );

        setHistory({ errored: true });
        await waitFor(() => expect(staleNote()).toBeTruthy());

        expect(
          within(staleNote()!).queryByRole("button", { name: /try again/i }),
        ).toBeNull();
      });
    });
  });

  describe("given a turn is running before its question has landed", () => {
    describe("when the poll behind it fails", () => {
      it("keeps the working column instead of the failure card", async () => {
        // The OTHER half of the stale condition, and the one an empty
        // transcript hides: a turn in flight is content of its own. Between
        // send and a terminal state the column owes the reader a working line
        // — never a card claiming the conversation is gone — even though there
        // is not a single message on screen to protect yet. Narrow the
        // condition to `!isEmpty` and this case loses its live turn to the
        // failure card.
        historyState.hasMessages = false;
        historyState.turnInFlight = true;

        renderOpenPanel();
        await waitFor(() => expect(failureCard()).toBeNull());

        setHistory({ errored: true });

        await waitFor(() => expect(staleNote()).toBeTruthy());
        expect(failureCard()).toBeNull();
      });
    });
  });

  describe("given the conversation was deleted from another tab", () => {
    describe("when the poll behind the open transcript answers not-found", () => {
      it("hands the column to the card that says what to do next", async () => {
        // The failure that never self-heals. Every poll from here on answers
        // the same thing, and the engine still holds the messages — so a rule
        // that only asks "is there content on screen?" demoted this to a
        // one-line footnote and left the reader working through a transcript
        // that no longer exists, with no retry and no way forward.
        renderOpenPanel();
        await waitFor(() =>
          expect(document.body.textContent).toContain(QUESTION),
        );

        setHistory({
          errored: true,
          errorCode: "langy_conversation_not_found",
        });

        await waitFor(() =>
          expect(
            screen.queryByText(/this conversation is no longer available/i),
          ).toBeTruthy(),
        );
        expect(staleNote()).toBeNull();
      });
    });
  });

  describe("given the open conversation belongs to someone else", () => {
    describe("when the poll answers not-owned", () => {
      it("hands the column to the card, not the stale line", async () => {
        renderOpenPanel();
        await waitFor(() =>
          expect(document.body.textContent).toContain(QUESTION),
        );

        setHistory({
          errored: true,
          errorCode: "langy_conversation_not_owned",
        });

        await waitFor(() =>
          expect(
            screen.queryByText(/only the owner can continue them/i),
          ).toBeTruthy(),
        );
        expect(staleNote()).toBeNull();
      });
    });
  });

  describe("given the read failed with nothing to show", () => {
    describe("when the panel opens on it", () => {
      it("owns the column with the failure card", async () => {
        historyState.hasData = false;
        historyState.errored = true;

        renderOpenPanel();

        await waitFor(() => expect(failureCard()).toBeTruthy());
        expect(staleNote()).toBeNull();
      });
    });
  });
});
