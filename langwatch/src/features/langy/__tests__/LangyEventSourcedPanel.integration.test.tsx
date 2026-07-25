/**
 * @vitest-environment jsdom
 *
 * The panel's picture of a conversation IS the recorded conversation (ADR-059):
 * the snapshot it reads back after a refresh, the optimistic overlay that
 * covers the instant between clicking Send and the backend accepting the turn,
 * the rollback when the backend refuses, and the ahead-only rule that keeps a
 * momentarily-stale durable read from shortening what is on screen.
 *
 * Spec: specs/langy/langy-event-sourced-frontend.feature
 *
 * Boundary mocks: the project context, the `~/utils/api` tRPC surface (an
 * in-memory stand-in serving the real DTO shapes, including the snapshot's
 * `eventCursor` / `currentTurnId`), and `@ai-sdk/react`'s `useChat` — modelled
 * as a real little engine (its messages are state the panel can read back and
 * `setMessages` writes through) so assertions are about what the conversation
 * RENDERS, not about which mock function was called. Everything under test —
 * the panel, the composer, the store, the fold — is real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures + observation state, declared at top level so the hoisted vi.mock
// factories close over them.
// ---------------------------------------------------------------------------

const PROJECT_ID = "project-demo";
const CONVERSATION_ID = "conv-recorded";

interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface Snapshot {
  messages: ApiMessage[];
  isTurnInFlight: boolean;
  inFlightTurnId: string | null;
  eventCursor: { acceptedAt: number; eventId: string } | null;
  /** The turn the record has in flight — what a refreshed tab adopts. */
  currentTurnId: string | null;
}

const snapshotRef: { current: Snapshot } = {
  current: {
    messages: [],
    isTurnInFlight: false,
    inFlightTurnId: null,
    eventCursor: null,
    currentTurnId: null,
  },
};

/** Re-run the history read — the durable snapshot changed under the panel. */
const historyListeners = new Set<() => void>();
const historyState = { version: 0 };
const refreshHistory = () =>
  act(() => {
    historyState.version++;
    historyListeners.forEach((notify) => notify());
  });

// --- the chat engine boundary ----------------------------------------------
// `useChat` holds the rendered thread. The real SDK appends the user's message
// the moment `sendMessage` is called and routes a rejected send to `error`;
// this stand-in does the same over a tiny observable store, so the panel's own
// reads (`messages`, `status`, `error`) and writes (`setMessages`) behave.

interface EngineMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: string; text?: string }>;
}

const engine = {
  version: 0,
  messages: [] as EngineMessage[],
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  error: null as Error | null,
  /** What the backend does with the next send. */
  rejectSendWith: null as Error | null,
  listeners: new Set<() => void>(),
};

const notifyEngine = () => {
  engine.version++;
  engine.listeners.forEach((notify) => notify());
};

const setEngineMessages = (messages: EngineMessage[]) => {
  engine.messages = messages;
  notifyEngine();
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
        status: engine.status,
        error: engine.error,
        sendMessage: async (message: {
          role: string;
          parts: Array<{ type: string; text?: string }>;
        }) => {
          // Optimistic, exactly like the SDK: the question is in the thread
          // before any request settles.
          engine.messages = [
            ...engine.messages,
            {
              id: `local-${engine.messages.length}`,
              role: "user",
              parts: message.parts,
            },
          ];
          engine.status = "submitted";
          notifyEngine();
          if (engine.rejectSendWith) {
            // A refused turn never throws out of `sendMessage` — the SDK routes
            // it to the `error` channel, which is why the panel's rollback
            // hangs off an effect rather than a catch.
            engine.error = engine.rejectSendWith;
            engine.status = "error";
            notifyEngine();
          }
        },
        setMessages: (messages: EngineMessage[]) => setEngineMessages(messages),
        stop: () => undefined,
        clearError: () => {
          engine.error = null;
          notifyEngine();
        },
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

// Purely cosmetic and WebGL-backed, which jsdom does not provide.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("~/utils/api", async () => {
  const React = await import("react");

  /** A minimal, `enabled`-honouring stand-in for a tRPC query. */
  const useSnapshotQuery = <TData,>(
    resolve: () => TData,
    enabled: boolean,
  ) => {
    const version = React.useSyncExternalStore(
      (notify: () => void) => {
        historyListeners.add(notify);
        return () => historyListeners.delete(notify);
      },
      () => historyState.version,
      () => historyState.version,
    );
    const [state, setState] = React.useState<{
      status: "loading" | "success";
      data: TData | undefined;
    }>({ status: "loading", data: undefined });

    React.useEffect(() => {
      if (!enabled) return;
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (!cancelled) setState({ status: "success", data: resolve() });
      });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, version]);

    return {
      data: state.data,
      isLoading: enabled && state.status === "loading",
      isInitialLoading: enabled && state.status === "loading",
      isFetching: enabled && state.status === "loading",
      isPreviousData: false,
      isFetched: state.status === "success",
      isSuccess: state.status === "success",
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
  // Every router this suite does not care about answers settled-idle.
  const routerProxy: unknown = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "useQuery" || prop === "useInfiniteQuery")
          return idleQuery;
        if (prop === "useMutation") return noopMutation;
        if (prop === "useSubscription") return () => undefined;
        return routerProxy;
      },
    },
  );

  /** Explicit procedures win; anything else on the router is inert. */
  const withFallback = (explicit: Record<string, unknown>) =>
    new Proxy(explicit, {
      get: (target, prop) =>
        prop in target ? target[prop as string] : (routerProxy as never),
    });

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: { pages: [{ items: [], nextCursor: null }], pageParams: [] },
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
        ) =>
          useSnapshotQuery(() => {
            const snapshot = snapshotRef.current;
            return {
              messages: snapshot.messages.map((message) => ({
                id: message.id,
                role: message.role,
                parts: [{ type: "text", text: message.text }],
                createdAtMs: 0,
              })),
              lastError: null,
              isTurnInFlight: snapshot.isTurnInFlight,
              inFlightTurnId: snapshot.inFlightTurnId,
              shouldAskFeedback: false,
              eventCursor: snapshot.eventCursor,
              currentTurnId: snapshot.currentTurnId,
            };
          }, opts?.enabled !== false && !!input.conversationId),
      },
      stopTurn: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
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
    virtualKeys: { list: { useQuery: () => ({ data: undefined, isLoading: false }) } },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

/**
 * Mount the panel the way a REFRESH does: the store is a singleton holding the
 * durable conversation pointer and its scope, and the panel re-enters the same
 * project — which restores the conversation and loads its snapshot.
 */
function renderReloadedPanel() {
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

const composerField = (): HTMLTextAreaElement => {
  const field = document.querySelector("textarea");
  expect(field, "the composer's message field").toBeTruthy();
  return field as HTMLTextAreaElement;
};

/** A recorded step, in the wire shape the tail read serves. */
const recordedAccepted = (o: { id: string; createdAt: number; turnId: string }) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  data: { conversationId: CONVERSATION_ID, turnId: o.turnId },
});

const recordedResponded = (o: {
  id: string;
  createdAt: number;
  turnId: string;
  outcome: "completed" | "stopped" | "failed";
  text: string;
}) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  data: {
    conversationId: CONVERSATION_ID,
    turnId: o.turnId,
    messageId: "message-answer",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: o.text }],
    outcome: o.outcome,
  },
});

beforeEach(() => {
  snapshotRef.current = {
    messages: [],
    isTurnInFlight: false,
    inFlightTurnId: null,
    eventCursor: null,
    currentTurnId: null,
  };
  historyState.version = 0;
  engine.messages = [];
  engine.status = "ready";
  engine.error = null;
  engine.rejectSendWith = null;
  engine.version = 0;
  useLangyStore.setState({ scopeAnnounced: false });
  useLangyStore.getState().resetForProject(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  useLangyStore.setState({ scopeAnnounced: false });
  useLangyStore.getState().resetForProject(PROJECT_ID);
});

describe("given a turn I stopped partway is on the record", () => {
  describe("when the page is refreshed and the conversation read back", () => {
    /** @scenario A stopped turn looks stopped after a refresh */
    it("keeps the partial answer and shows the turn settled, not running", async () => {
      // The stopped terminal is recorded: the partial answer reached the
      // message projection, and the record names no turn in flight.
      snapshotRef.current = {
        messages: [
          { id: "m1", role: "user", text: "summarise last night's failures" },
          { id: "m2", role: "assistant", text: "I got as far as the retriever" },
        ],
        isTurnInFlight: false,
        inFlightTurnId: null,
        // The message projection has the answer; the turn fold's own cursor is
        // a beat behind it, so the stopped terminal is still on the tail.
        eventCursor: { acceptedAt: 1_000, eventId: "event-1" },
        currentTurnId: null,
      };

      renderReloadedPanel();

      expect(
        await screen.findByText("I got as far as the retriever"),
      ).toBeTruthy();
      // Settled and continuable: Send, never Stop or Stopping, and no red card.
      expect(await screen.findByLabelText("Send")).toBeTruthy();
      expect(screen.queryByLabelText("Stop")).toBeNull();
      expect(screen.queryByLabelText("Stopping")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();

      // The catch-up tail carries the stopped terminal itself — folding it must
      // not resurrect the turn, and the local projection says how it ended.
      act(() => {
        useLangyStore.getState().applyTurnEvents([
          recordedResponded({
            id: "event-2",
            createdAt: 2_000,
            turnId: "turn-stopped",
            outcome: "stopped",
            text: "I got as far as the retriever",
          }),
        ]);
      });

      expect(useLangyStore.getState().turnProjection.turn?.Status).toBe(
        "stopped",
      );
      expect(useLangyStore.getState().turnPhase).toBe("idle");
      expect(await screen.findByLabelText("Send")).toBeTruthy();
      expect(
        screen.getByText("I got as far as the retriever"),
      ).toBeTruthy();
    });
  });
});

describe("given a conversation with the composer ready", () => {
  describe("when I send a message", () => {
    /** @scenario A just-sent message appears at once and settles as recorded */
    it("shows it immediately and reconciles it with the recorded turn", async () => {
      snapshotRef.current = {
        messages: [],
        isTurnInFlight: false,
        inFlightTurnId: null,
        eventCursor: { acceptedAt: 1_000, eventId: "event-0" },
        currentTurnId: null,
      };

      renderReloadedPanel();
      await screen.findByLabelText("Send");

      await userEvent.type(composerField(), "why is p95 up?");
      await userEvent.click(screen.getByLabelText("Send"));

      // Immediately: the question is in the conversation and out of the field,
      // before anything about it has been recorded.
      expect(await screen.findByText("why is p95 up?")).toBeTruthy();
      expect(composerField().value).toBe("");
      expect(useLangyStore.getState().turnProjection.turn).toBeNull();

      // The backend accepts the command and hands back the ids — the optimistic
      // overlay the panel's transport puts on the phase before any fold.
      act(() => {
        useLangyStore
          .getState()
          .beginTurn({ conversationId: CONVERSATION_ID, turnId: "turn-sent" });
      });
      expect(await screen.findByLabelText("Stop")).toBeTruthy();

      // …and then the recorded step for that same turn arrives. It reconciles
      // with the overlay rather than opening a second turn, and the question is
      // still in the conversation exactly once.
      act(() => {
        useLangyStore
          .getState()
          .applyTurnEvents([
            recordedAccepted({
              id: "event-1",
              createdAt: 2_000,
              turnId: "turn-sent",
            }),
          ]);
      });

      const store = useLangyStore.getState();
      expect(store.turnPhase).toBe("active");
      expect(store.activeTurnId).toBe("turn-sent");
      expect(store.turnProjection.turnId).toBe("turn-sent");
      expect(store.turnProjection.turn?.Status).toBe("running");
      expect(screen.getAllByText("why is p95 up?")).toHaveLength(1);
      expect(await screen.findByLabelText("Stop")).toBeTruthy();
    });
  });
});

describe("given the backend refuses my turn with a clear reason", () => {
  describe("when the refusal reaches the panel", () => {
    /** @scenario A send the backend rejects rolls back cleanly */
    it("gives the draft back and leaves no turn claiming to be in flight", async () => {
      snapshotRef.current = {
        messages: [],
        isTurnInFlight: false,
        inFlightTurnId: null,
        eventCursor: { acceptedAt: 1_000, eventId: "event-0" },
        currentTurnId: null,
      };
      engine.rejectSendWith = new Error("Langy is still replying");

      renderReloadedPanel();
      await screen.findByLabelText("Send");

      await userEvent.type(composerField(), "compare the two runs");
      await userEvent.click(screen.getByLabelText("Send"));

      // The words come back rather than being eaten by the failed send.
      await waitFor(() => {
        expect(composerField().value).toBe("compare the two runs");
      });
      expect(useLangyStore.getState().draft).toBe("compare the two runs");

      // No phantom turn: nothing was recorded, nothing is claimed to be in
      // flight, and the composer is available to try again.
      const store = useLangyStore.getState();
      expect(store.turnPhase).toBe("idle");
      expect(store.activeTurnId).toBeNull();
      expect(store.turnProjection.turn).toBeNull();
      expect(screen.queryByLabelText("Stop")).toBeNull();
      expect(await screen.findByLabelText("Send")).toBeTruthy();
      // The reason is surfaced, not swallowed.
      expect(await screen.findByRole("alert")).toBeTruthy();
    });
  });
});

describe("given the streamed answer is on screen", () => {
  describe("when a durable read that is behind it lands", () => {
    /** @scenario Streamed text never regresses the folded answer */
    it("never shortens the rendered answer, and applies the record only once it is ahead", async () => {
      // The record has not caught up with the answer that just streamed: the
      // settle-boundary window where the fold still holds only the question.
      snapshotRef.current = {
        messages: [{ id: "m1", role: "user", text: "what changed overnight?" }],
        isTurnInFlight: false,
        inFlightTurnId: null,
        eventCursor: { acceptedAt: 1_000, eventId: "event-1" },
        currentTurnId: null,
      };

      renderReloadedPanel();
      await screen.findByText("what changed overnight?");

      // The streamed answer is in the thread.
      act(() =>
        setEngineMessages([
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "what changed overnight?" }],
          },
          {
            id: "local-answer",
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "The retriever regressed after the reindex.",
              },
            ],
          },
        ]),
      );
      await screen.findByText("The retriever regressed after the reindex.");

      // A durable read that is BEHIND arrives — it must not shorten the answer.
      refreshHistory();
      await waitFor(() => {
        expect(
          screen.getByText("The retriever regressed after the reindex."),
        ).toBeTruthy();
      });

      // Once the record is AHEAD of the thread it takes over, and what it
      // brings is longer still — never shorter.
      snapshotRef.current = {
        ...snapshotRef.current,
        messages: [
          { id: "m1", role: "user", text: "what changed overnight?" },
          {
            id: "m2",
            role: "assistant",
            text: "The retriever regressed after the reindex.",
          },
          { id: "m3", role: "user", text: "and the cost?" },
        ],
      };
      refreshHistory();

      expect(await screen.findByText("and the cost?")).toBeTruthy();
      expect(
        screen.getByText("The retriever regressed after the reindex."),
      ).toBeTruthy();
    });
  });
});
