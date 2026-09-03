/**
 * @vitest-environment jsdom
 *
 * Integration tests for LangyPanel conversation history, the turn failures it
 * must not swallow, and stopping a turn.
 * Specs: specs/langy/langy-baseline.feature,
 *        specs/langy/langy-stop-and-resume.feature
 *
 * Boundary mocks: the host port (project context), `@ai-sdk/react` useChat (no
 * real streaming), `@langwatch/ui-drawer`, and the `behavior/langy-api` tRPC
 * surface (an in-memory stand-in that serves the real DTO shapes). No REST
 * fetch, no DB, no MSW — the whole Langy conversation surface goes through
 * tRPC now, so the mock does too.
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
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

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

// ---------------------------------------------------------------------------
// Shared fixtures + observation state
//
// Declared at top level so the hoisted vi.mock factory below closes over them
// (the same mechanism the existing projectRef / chatRef mocks rely on): the
// factory only runs when `behavior/langy-api` is first imported — by which
// point these are live — and reads them on every render.
// ---------------------------------------------------------------------------

/** A recent-list row, in the real `langyConversationListItemSchema` shape. */
interface ApiConversation {
  id: string;
  title: string | null;
  lastActivityAtMs: number;
}
/**
 * A history message. `text` is a fixture convenience for the single text part;
 * the mock expands it into the real `parts` array the panel reads.
 */
interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}
interface Scenario {
  conversations: ApiConversation[];
  messagesById: Record<string, ApiMessage[]>;
  failList: boolean;
  /** When set, the list query stays in `loading` until `gate` resolves. */
  slowList: { gate: Promise<void> } | null;
  /**
   * What the DURABLE record says about a turn in flight, per conversation —
   * `langy.messages`'s `isTurnInFlight` / `inFlightTurnId`. A turn is in flight
   * whenever this is set, and `turnId` is null to model the window between a
   * message being sent and its turn being accepted on the record.
   */
  turnInFlightById: Record<string, { turnId: string | null }>;
  /** Reject the stop mutation, to model a request that never lands. */
  failStop: boolean;
}

const scenarioRef: { current: Scenario } = {
  current: {
    conversations: [],
    messagesById: {},
    failList: false,
    slowList: null,
    turnInFlightById: {},
    failStop: false,
  },
};

// What the panel asked of each procedure — the tRPC-native replacement for the
// old "inspect the fetch URL" assertions.
const spies = {
  listQuery:
    vi.fn<
      (
        input: { projectId: string; limit: number; query?: string },
        enabled: boolean,
      ) => void
    >(),
  deleteMutation:
    vi.fn<(variables: { projectId: string; conversationId: string }) => void>(),
  listInvalidate: vi.fn<(input: unknown) => void>(),
  stopMutation:
    vi.fn<
      (variables: {
        projectId: string;
        conversationId: string;
        turnId: string;
      }) => void
    >(),
};

// Invalidation channel: utils.langy.list.invalidate() bumps a version every
// armed list query subscribes to, so a delete refreshes the recents list the
// way React Query would.
const listListeners = new Set<() => void>();
const listState = { version: 0 };
const bumpList = () => {
  listState.version++;
  listListeners.forEach((notify) => notify());
};

const projectRef = {
  current: { id: "project-demo", slug: "demo" } as {
    id: string;
    slug: string;
  } | null,
};

// The minimised affordance is flag-gated (LangySidecar reads
// release_ui_langy_peek_dock_enabled). This suite is about conversation
// history, not the closed state, so pin the flag off (the classic launcher) —
// the same render path this suite had before the flag landed.
vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    currentDrawer: undefined,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
}));

// Cuts the model picker's dependency chain onto the (unrelated) workflow
// studio host — this suite is about conversation history, not the picker.
vi.mock("../../elements/langy-model-pill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

// useChat — controllable surface for messages + sendMessage spy.
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
  clearError: vi.fn(),
  regenerate: vi.fn(),
  error: null as Error | null,
};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatRef.messages,
    sendMessage: chatRef.sendMessage,
    stop: chatRef.stop,
    status: chatRef.status,
    setMessages: chatRef.setMessages,
    error: chatRef.error,
    clearError: chatRef.clearError,
    regenerate: chatRef.regenerate,
  }),
}));

// The whole Langy tRPC surface, served from `scenarioRef`. Each procedure
// returns the exact shape the real router returns — `langy.list` yields
// `{ items }` of list rows, `langy.messages` yields `{ messages, lastError,
// isTurnInFlight }` with real `parts`, `deleteConversation` archives + drives
// the invalidation channel. The model-picker queries are stubbed idle-but-
// finished so React Query treats them as settled.
vi.mock("../../../../../behavior/langy-api", async () => {
  const React = await import("react");
  // Peripheral menus in the panel header (GitHub connect, etc.) each pull
  // their own tRPC queries these tests do not care about; the shared harness
  // answers every one of them inert. Only the langy surface and the model
  // picker below are explicit.
  const { createTrpcUtils, modelProviderRouter, withFallback } = await import(
    "../../../__tests__/support/langy-api-mock"
  );

  // A minimal, `enabled`-honouring stand-in for a tRPC query: one async
  // resolution per arm / refetch / invalidate, loading → success | error, no
  // retries. `resolve` reads the in-memory scenario and may throw to model an
  // error; `subscribeInvalidation` re-runs it when the list cache is bumped.
  // Disabled queries never resolve, exactly like React Query — the closed-panel
  // scenarios depend on that being real.
  const useScenarioQuery = <TData,>(
    resolve: () => Promise<TData>,
    enabled: boolean,
    subscribeInvalidation = false,
  ) => {
    const version = React.useSyncExternalStore(
      (notify: () => void) => {
        if (!subscribeInvalidation) return () => undefined;
        listListeners.add(notify);
        return () => listListeners.delete(notify);
      },
      () => (subscribeInvalidation ? listState.version : 0),
    );
    const [nonce, setNonce] = React.useState(0);
    const [state, setState] = React.useState<{
      status: "loading" | "success" | "error";
      data: TData | undefined;
      error: unknown;
      fetched: boolean;
    }>({ status: "loading", data: undefined, error: null, fetched: false });

    React.useEffect(() => {
      if (!enabled) return;
      let cancelled = false;
      resolve().then(
        (data) => {
          if (!cancelled)
            setState({ status: "success", data, error: null, fetched: true });
        },
        (error) => {
          if (!cancelled)
            setState({
              status: "error",
              data: undefined,
              error,
              fetched: true,
            });
        },
      );
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, nonce, version]);

    return {
      data: state.data,
      // isLoading, not isFetching: React Query v4 reports a DISABLED
      // query as status "loading" forever, and the panel deliberately disables
      // the list while closed — so the production hook reads isLoading.
      // Mirror that: only a query that is BOTH enabled AND still loading counts.
      isLoading: enabled && state.status === "loading",
      isFetching: enabled && state.status === "loading",
      isPlaceholderData: false,
      isFetched: state.fetched,
      isError: state.status === "error",
      error: state.error,
      refetch: () => {
        setNonce((n) => n + 1);
        return Promise.resolve();
      },
    };
  };

  type ListInput = { projectId: string; limit: number; query?: string };
  type ListCursor = { lastActivityAtMs: number | null; id: string };

  const resolveListPage = async (input: ListInput, cursor?: ListCursor) => {
    const scenario = scenarioRef.current;
    if (scenario.slowList) await scenario.slowList.gate;
    if (scenario.failList) throw new Error("list unavailable");
    const query = input.query?.trim().toLowerCase();
    const visible = scenario.conversations
      .filter((conversation) =>
        query ? conversation.title?.toLowerCase().includes(query) : true,
      )
      .sort((a, b) => {
        const byActivity = b.lastActivityAtMs - a.lastActivityAtMs;
        return byActivity !== 0 ? byActivity : b.id.localeCompare(a.id);
      });
    const cursorIndex = cursor
      ? visible.findIndex(
          (conversation) =>
            conversation.id === cursor.id &&
            conversation.lastActivityAtMs === cursor.lastActivityAtMs,
        )
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const items = visible.slice(start, start + input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        start + items.length < visible.length && last
          ? { lastActivityAtMs: last.lastActivityAtMs, id: last.id }
          : null,
    };
  };

  const useScenarioInfiniteListQuery = (input: ListInput, enabled: boolean) => {
    const version = React.useSyncExternalStore(
      (notify: () => void) => {
        listListeners.add(notify);
        return () => listListeners.delete(notify);
      },
      () => listState.version,
    );
    const [nonce, setNonce] = React.useState(0);
    const [isFetchingNextPage, setIsFetchingNextPage] = React.useState(false);
    const [state, setState] = React.useState<{
      status: "loading" | "success" | "error";
      data:
        | {
            pages: Awaited<ReturnType<typeof resolveListPage>>[];
            pageParams: Array<ListCursor | undefined>;
          }
        | undefined;
      error: unknown;
      fetched: boolean;
    }>({ status: "loading", data: undefined, error: null, fetched: false });

    React.useEffect(() => {
      if (!enabled) return;
      let cancelled = false;
      setState((previous) => ({
        ...previous,
        status: "loading",
        error: null,
      }));
      resolveListPage(input).then(
        (page) => {
          if (!cancelled) {
            setState({
              status: "success",
              data: { pages: [page], pageParams: [undefined] },
              error: null,
              fetched: true,
            });
          }
        },
        (error) => {
          if (!cancelled) {
            setState({
              status: "error",
              data: undefined,
              error,
              fetched: true,
            });
          }
        },
      );
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, input.projectId, input.limit, input.query, nonce, version]);

    const fetchNextPage = async () => {
      const cursor = state.data?.pages.at(-1)?.nextCursor ?? undefined;
      if (!cursor) return;
      setIsFetchingNextPage(true);
      try {
        const page = await resolveListPage(input, cursor);
        setState((previous) => ({
          status: "success",
          data: {
            pages: [...(previous.data?.pages ?? []), page],
            pageParams: [...(previous.data?.pageParams ?? []), cursor],
          },
          error: null,
          fetched: true,
        }));
      } finally {
        setIsFetchingNextPage(false);
      }
    };

    return {
      data: state.data,
      isLoading:
        enabled && state.status === "loading" && state.data === undefined,
      isFetching: enabled && state.status === "loading",
      isPlaceholderData: state.status === "loading" && state.data !== undefined,
      isFetched: state.fetched,
      isError: state.status === "error",
      error: state.error,
      refetch: () => {
        setNonce((n) => n + 1);
        return Promise.resolve();
      },
      fetchNextPage,
      hasNextPage: !!state.data?.pages.at(-1)?.nextCursor,
      isFetchingNextPage,
    };
  };

  // The React Query utils tree, shared by useUtils() and useContext(). Only
  // list.invalidate does real work here — it drives the recents refresh after a
  // delete, which is this suite's own business; the rest of the tree comes from
  // the shared harness.
  const trpcUtils = createTrpcUtils({
    onListInvalidate: (input) => {
      spies.listInvalidate(input);
      bumpList();
    },
  });

  const explicitApi: Record<string, unknown> = {
    langy: {
      list: {
        useInfiniteQuery: (
          input: { projectId: string; limit: number; query?: string },
          opts?: { enabled?: boolean },
        ) => {
          const enabled = opts?.enabled !== false;
          spies.listQuery(input, enabled);
          return useScenarioInfiniteListQuery(input, enabled);
        },
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
          useScenarioQuery(
            async () => ({
              messages: (
                scenarioRef.current.messagesById[input.conversationId] ?? []
              ).map((m) => ({
                id: m.id,
                role: m.role,
                parts: [{ type: "text", text: m.text }],
                createdAtMs: 0,
              })),
              lastError: null,
              isTurnInFlight:
                input.conversationId in scenarioRef.current.turnInFlightById,
              inFlightTurnId:
                scenarioRef.current.turnInFlightById[input.conversationId]
                  ?.turnId ?? null,
            }),
            opts?.enabled !== false,
          ),
      },
      deleteConversation: {
        useMutation: (opts?: {
          onSuccess?: (result: unknown, variables: unknown) => void;
        }) => ({
          mutateAsync: async (variables: {
            projectId: string;
            conversationId: string;
          }) => {
            spies.deleteMutation(variables);
            scenarioRef.current.conversations =
              scenarioRef.current.conversations.filter(
                (c) => c.id !== variables.conversationId,
              );
            opts?.onSuccess?.({ success: true }, variables);
            return { success: true };
          },
          isPending: false,
        }),
      },
      renameConversation: {
        useMutation: () => ({
          mutateAsync: () => Promise.resolve(),
          isPending: false,
        }),
      },
      warmWorker: {
        useMutation: () => ({ mutate: () => undefined }),
      },
      stopTurn: {
        useMutation: () => ({
          mutateAsync: async (variables: {
            projectId: string;
            conversationId: string;
            turnId: string;
          }) => {
            spies.stopMutation(variables);
            if (scenarioRef.current.failStop) {
              throw new Error("stop request did not land");
            }
            return { stopped: true };
          },
        }),
      },
      recordFeedback: {
        useMutation: () => ({
          mutate: () => undefined,
          mutateAsync: () => Promise.resolve(),
          isPending: false,
        }),
      },
      onConversationUpdate: {
        useSubscription: () => undefined,
      },
    },
    // useUtils / useContext (its older alias) return the same tree. Beyond the
    // delete's list.invalidate, useLangyFreshness reaches for
    // list.getData/setData/cancel, messages.invalidate and detail.setData —
    // all driven off the SSE signal, which never fires here, so they are inert
    // no-ops that only need to EXIST at render time.
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: modelProviderRouter(),
    virtualKeys: {
      list: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
    github: {
      getConnectionStatus: {
        // Feature off in these tests — the header GitHub button hides
        // itself (isLoading=false, data=undefined) and stays out of the way.
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
  };

  return { api: withFallback(explicitApi), trpcClient: {} };
});

import { toaster } from "@langwatch/design-system/toaster";
import { LangySidecar } from "../langy-panel";
import { LangyProvider } from "../langy-context";
import { useLangyStore } from "../../../../../index";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class FakeLangyHost extends LangyHostPort {
  project() {
    return projectRef.current
      ? { id: projectRef.current.id, slug: projectRef.current.slug, name: projectRef.current.slug }
      : undefined;
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
const host = new FakeLangyHost();

// The panel reads its per-page registration context (proposal handlers, page
// context chips) from LangyProvider — the real app mounts it above the panel,
// so the test does too.
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyHostProvider value={host}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
  </ChakraProvider>
);

interface UIMessageLike {
  id: string;
  role: string;
  parts?: Array<{ type: string; text?: string }>;
}

/** Build a list row, taking an ISO date purely as an ordering key. */
function makeConv(
  id: string,
  title: string,
  lastActivity: string,
): ApiConversation {
  return { id, title, lastActivityAtMs: Date.parse(lastActivity) };
}

/**
 * Point the tRPC mock at a scenario and hand back the spies so a test can
 * assert what the panel asked of each procedure. `slowList` holds the list
 * query in `loading` until the test calls `slow.resolveLater()`.
 */
function installScenario(scenario: {
  conversations: ApiConversation[];
  messagesById: Record<string, ApiMessage[]>;
  failList?: boolean;
  slowList?: { resolveLater: () => void };
  turnInFlightById?: Record<string, { turnId: string | null }>;
  failStop?: boolean;
}) {
  let openGate: () => void = () => undefined;
  const gate = scenario.slowList
    ? new Promise<void>((resolve) => {
        openGate = resolve;
      })
    : null;
  if (scenario.slowList) scenario.slowList.resolveLater = openGate;

  scenarioRef.current = {
    conversations: scenario.conversations,
    messagesById: scenario.messagesById,
    failList: scenario.failList ?? false,
    slowList: gate === null ? null : { gate },
    turnInFlightById: scenario.turnInFlightById ?? {},
    failStop: scenario.failStop ?? false,
  };
  return spies;
}

function renderPanel() {
  return render(<LangySidecar />, {
    wrapper: Wrapper,
  });
}

/**
 * History is its own icon control in the header rail. Activating it swaps the
 * panel BODY to the full-height recents list (RecentChatsView), so
 * conversations are only in the DOM while that view is showing — the rows are
 * ordinary list items, not combobox options.
 */
const recentsTrigger = () =>
  screen.findByRole("button", { name: "Recent chats" });

async function openHistory() {
  await userEvent.click(await recentsTrigger());
}

function recentOption(pattern: RegExp): HTMLElement | undefined {
  return screen
    .queryAllByRole("listitem")
    .find((row) => pattern.test(row.textContent ?? ""));
}

async function findRecentOption(pattern: RegExp): Promise<HTMLElement> {
  let option: HTMLElement | undefined;
  await waitFor(() => {
    option = recentOption(pattern);
    expect(option).toBeDefined();
  });
  return option!;
}

/**
 * Open a conversation from the list. The row is a CONTAINER holding two sibling
 * controls — the title (which opens the chat) and the ⋯ (row actions) — so the
 * click has to land on the title button, not on the row itself.
 */
async function openRecentOption(pattern: RegExp): Promise<void> {
  const row = await findRecentOption(pattern);
  // The title button is the row's other control — everything except the ⋯.
  const titleButton = within(row)
    .getAllByRole("button")
    .find(
      (button) => button.getAttribute("aria-label") !== "Conversation actions",
    );
  expect(titleButton).toBeDefined();
  await userEvent.click(titleButton!);
}

async function deleteRecentOption(option: HTMLElement): Promise<void> {
  await userEvent.hover(option);
  await userEvent.click(
    within(option).getByRole("button", { name: "Conversation actions" }),
  );
  await userEvent.click(
    await screen.findByRole("menuitem", { name: /delete/i }),
  );
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

beforeEach(() => {
  projectRef.current = { id: "project-demo", slug: "demo" };
  chatRef.messages = [];
  chatRef.status = "ready";
  chatRef.sendMessage.mockReset();
  chatRef.stop.mockReset();
  chatRef.setMessages.mockReset();
  chatRef.clearError.mockReset();
  chatRef.regenerate.mockReset();
  chatRef.error = null;
  (toaster.create as Mock).mockReset();
  spies.listQuery.mockReset();
  spies.deleteMutation.mockReset();
  spies.listInvalidate.mockReset();
  spies.stopMutation.mockReset();
  scenarioRef.current = {
    conversations: [],
    messagesById: {},
    failList: false,
    slowList: null,
    turnInFlightById: {},
    failStop: false,
  };
  // These suites exercise an OPEN panel; a closed panel deliberately never
  // fetches the recents list (see useLangyConversationListQuery).
  //
  // The conversation pointer is cleared explicitly because the store is a module
  // SINGLETON and the pointer is now durable: without this, a conversation
  // selected in one test is restored by the next one's mount (which is the
  // correct product behaviour, and exactly why the test has to opt out of it).
  useLangyStore.setState({
    isOpen: true,
    activeConversationId: null,
    activeConversationScope: null,
    historyLoadConversationId: null,
    // The turn phase is on the same singleton: a test that leaves a turn active
    // would hand the next one a composer stuck on Stop.
    turnPhase: "idle",
    activeTurnId: null,
    settledTurnId: null,
    backendSawTurnInFlight: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("LangyPanel conversation history", () => {
  describe("given existing conversations in the current project", () => {
    const conversations = [
      makeConv("conv-old", "Older chat", "2026-05-01T10:00:00.000Z"),
      makeConv("conv-new", "Newest chat", "2026-05-10T10:00:00.000Z"),
    ];
    const messagesById = {
      "conv-new": [
        { id: "m1", role: "user" as const, text: "hello from newest" },
      ],
      "conv-old": [
        { id: "m2", role: "user" as const, text: "hello from older" },
      ],
    };

    describe("when the panel mounts", () => {
      it("arms the recent-list query with the current projectId", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await waitFor(() => {
          const call = spies.listQuery.mock.calls.find(
            ([, enabled]) => enabled,
          );
          expect(call, "list query should arm on mount").toBeTruthy();
          expect(call![0]).toMatchObject({ projectId: "project-demo" });
        });
      });

      it("starts fresh instead of implicitly opening the newest conversation", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await waitFor(() => {
          expect(chatRef.setMessages).toHaveBeenCalled();
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          expect(lastCall?.[0]).toEqual([]);
        });
        expect(useLangyStore.getState().activeConversationId).toBeNull();
      });

      it("renders the recent list ordered by last activity (newest first)", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await openHistory();
        const list = await screen.findByRole("list", { name: "Recent chats" });
        const items = within(list).getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("Newest chat");
        expect(items[1]).toHaveTextContent("Older chat");
      });
    });

    describe("when more conversations exist than one page", () => {
      const pagedConversations = Array.from({ length: 35 }, (_, index) => ({
        id: `paged-${index + 1}`,
        title: index === 34 ? "Needle archive" : `Paged chat ${index + 1}`,
        lastActivityAtMs: 100_000 - index,
      }));

      it("renders one bounded page and loads older rows on demand", async () => {
        installScenario({
          conversations: pagedConversations,
          messagesById: {},
        });
        renderPanel();
        await openHistory();

        await waitFor(() => {
          expect(screen.getAllByRole("listitem")).toHaveLength(30);
        });
        expect(recentOption(/Needle archive/i)).toBeUndefined();

        await userEvent.click(
          screen.getByRole("button", {
            name: "Load older conversations",
          }),
        );

        await waitFor(() => {
          expect(screen.getAllByRole("listitem")).toHaveLength(35);
        });
        expect(recentOption(/Needle archive/i)).toBeDefined();
      });

      it("searches on the server and can find a row beyond the first page", async () => {
        installScenario({
          conversations: pagedConversations,
          messagesById: {},
        });
        renderPanel();
        await openHistory();

        await userEvent.type(
          await screen.findByPlaceholderText("Search chats"),
          "Needle",
        );

        await waitFor(() => {
          expect(
            spies.listQuery.mock.calls
              .filter(([, enabled]) => enabled)
              .map(([input]) => input.query),
          ).toContain("Needle");
        });
        expect(await findRecentOption(/Needle archive/i)).toBeInTheDocument();
      });
    });

    describe("when the user clicks a conversation in the recent list", () => {
      it("switches the panel to that conversation's messages", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await openHistory();
        chatRef.setMessages.mockClear();
        await openRecentOption(/Older chat/i);
        await waitFor(() => {
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          const passed = lastCall?.[0] as UIMessageLike[] | undefined;
          expect(passed?.[0]?.parts?.[0]?.text).toBe("hello from older");
        });
      });
    });

    describe("when the user clicks 'New chat'", () => {
      it("clears the message stream", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await recentsTrigger();
        chatRef.setMessages.mockClear();
        await userEvent.click(
          screen.getByRole("button", { name: /new chat/i }),
        );
        await waitFor(() => {
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          expect(lastCall?.[0]).toEqual([]);
        });
      });

      it("keeps the prior conversation in the recent list", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await recentsTrigger();
        await userEvent.click(
          screen.getByRole("button", { name: /new chat/i }),
        );
        await openHistory();
        expect(await findRecentOption(/Newest chat/i)).toBeInTheDocument();
      });
    });

    describe("when the user deletes a conversation", () => {
      it("issues the delete command with the project and conversation id", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await openHistory();
        const olderItem = await findRecentOption(/Older chat/i);
        await deleteRecentOption(olderItem);
        await waitFor(() => {
          expect(spies.deleteMutation).toHaveBeenCalledWith({
            projectId: "project-demo",
            conversationId: "conv-old",
          });
        });
      });

      it("removes the deleted conversation from the recent list", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await openHistory();
        const olderItem = await findRecentOption(/Older chat/i);
        await deleteRecentOption(olderItem);
        await waitFor(() => {
          expect(recentOption(/Older chat/i)).toBeUndefined();
        });
      });

      it("switches to a fresh conversation if the deleted one was active", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await openHistory();
        await openRecentOption(/Newest chat/i);
        await waitFor(() => {
          expect(useLangyStore.getState().activeConversationId).toBe(
            "conv-new",
          );
        });
        await openHistory();
        const newestItem = await findRecentOption(/Newest chat/i);
        chatRef.setMessages.mockClear();
        await deleteRecentOption(newestItem);
        await waitFor(() => {
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          expect(lastCall?.[0]).toEqual([]);
        });
      });

      it("aborts any in-flight stream when the active conversation is deleted", async () => {
        installScenario({ conversations, messagesById });
        chatRef.status = "streaming";
        renderPanel();
        await openHistory();
        await openRecentOption(/Newest chat/i);
        await waitFor(() => {
          expect(useLangyStore.getState().activeConversationId).toBe(
            "conv-new",
          );
        });
        await openHistory();
        const newestItem = await findRecentOption(/Newest chat/i);
        chatRef.stop.mockClear();
        await deleteRecentOption(newestItem);
        await waitFor(() => {
          expect(chatRef.stop).toHaveBeenCalled();
        });
      });

      it("leaves the active conversation untouched when a different chat is deleted", async () => {
        installScenario({ conversations, messagesById });
        renderPanel();
        await openHistory();
        await openRecentOption(/Newest chat/i);
        await waitFor(() => {
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          expect(
            (lastCall?.[0] as UIMessageLike[] | undefined)?.[0]?.parts?.[0]
              ?.text,
          ).toBe("hello from newest");
        });
        await openHistory();
        // Delete the OLDER (non-active) chat.
        const olderItem = await findRecentOption(/Older chat/i);
        chatRef.setMessages.mockClear();
        chatRef.stop.mockClear();
        await deleteRecentOption(olderItem);
        // Wait until the older chat is removed from the list — proves the
        // delete completed — before asserting we did NOT reset the active.
        await waitFor(() => {
          expect(recentOption(/Older chat/i)).toBeUndefined();
        });
        // Active chat state must not be wiped.
        expect(chatRef.setMessages).not.toHaveBeenCalledWith([]);
        expect(chatRef.stop).not.toHaveBeenCalled();
      });
    });
  });

  describe("given another user owns conversations in the same project", () => {
    describe("when the recent list loads", () => {
      it("renders only the conversations returned by the API", async () => {
        // Backend filters by userId; UI must trust the response and not show
        // any conversation the API did not return.
        installScenario({
          conversations: [
            makeConv("mine-1", "My only chat", "2026-05-10T10:00:00.000Z"),
          ],
          messagesById: { "mine-1": [] },
        });
        renderPanel();
        await openHistory();
        const list = await screen.findByRole("list", { name: "Recent chats" });
        const items = within(list).getAllByRole("listitem");
        expect(items).toHaveLength(1);
        expect(items[0]).toHaveTextContent("My only chat");
      });
    });
  });

  describe("given the panel re-mounts in the same project", () => {
    describe("when a conversation was open before the remount", () => {
      it("restores it, so a refresh comes back to what the user left", async () => {
        const conversations = [
          makeConv("conv-a", "A", "2026-05-09T10:00:00.000Z"),
          makeConv("conv-b", "B", "2026-05-10T10:00:00.000Z"),
        ];
        const messagesById = {
          "conv-a": [{ id: "ma", role: "user" as const, text: "from A" }],
          "conv-b": [{ id: "mb", role: "user" as const, text: "from B" }],
        };
        installScenario({ conversations, messagesById });

        const { unmount } = renderPanel();
        await openHistory();
        await openRecentOption(/^B/);
        await waitFor(() => {
          const passed = chatRef.setMessages.mock.calls[
            chatRef.setMessages.mock.calls.length - 1
          ]?.[0] as UIMessageLike[] | undefined;
          expect(passed?.[0]?.parts?.[0]?.text).toBe("from B");
        });
        unmount();
        chatRef.setMessages.mockClear();

        // A refresh, in effect: the store is a singleton holding the durable
        // pointer, and the panel re-enters the SAME project.
        renderPanel();
        await waitFor(() => {
          const passed = chatRef.setMessages.mock.calls[
            chatRef.setMessages.mock.calls.length - 1
          ]?.[0] as UIMessageLike[] | undefined;
          expect(passed?.[0]?.parts?.[0]?.text).toBe("from B");
        });
        expect(useLangyStore.getState().activeConversationId).toBe("conv-b");
      });
    });
  });

  describe("given the projectId changes", () => {
    describe("when the panel re-renders with a new project", () => {
      it("refetches the recent list for the new project", async () => {
        installScenario({
          conversations: [
            makeConv("c1", "demo chat", "2026-05-10T10:00:00.000Z"),
          ],
          messagesById: { c1: [] },
        });
        const { unmount } = renderPanel();
        await waitFor(() => {
          expect(
            spies.listQuery.mock.calls.some(
              ([input, enabled]) =>
                enabled && input.projectId === "project-demo",
            ),
          ).toBe(true);
        });
        unmount();

        projectRef.current = { id: "project-other", slug: "other" };
        installScenario({
          conversations: [
            makeConv("c2", "other chat", "2026-05-10T11:00:00.000Z"),
          ],
          messagesById: { c2: [] },
        });
        renderPanel();
        await openHistory();
        await waitFor(() => {
          expect(recentOption(/other chat/i)).toBeDefined();
        });
      });

      it("does not render conversations from the previous project", async () => {
        // First mount: project-demo with "demo chat"
        installScenario({
          conversations: [
            makeConv("c1", "demo chat", "2026-05-10T10:00:00.000Z"),
          ],
          messagesById: { c1: [] },
        });
        const { unmount } = renderPanel();
        await recentsTrigger();
        unmount();

        // Re-mount: project-other with empty list
        projectRef.current = { id: "project-other", slug: "other" };
        installScenario({ conversations: [], messagesById: {} });
        renderPanel();
        await waitFor(() => {
          expect(recentOption(/demo chat/i)).toBeUndefined();
        });
      });
    });
  });

  describe("given the conversations API fails", () => {
    describe("when the panel is open", () => {
      it("surfaces a dismissable error card inside the panel, never a toast", async () => {
        installScenario({
          conversations: [],
          messagesById: {},
          failList: true,
        });
        renderPanel();
        const card = await screen.findByRole("alert");
        expect(card.textContent).toContain(
          "Recent conversations aren't loading",
        );
        expect(toaster.create).not.toHaveBeenCalled();
        expect(
          screen.queryByRole("list", { name: "Recent chats" }),
        ).not.toBeInTheDocument();

        // Dismissal hides the card for the rest of the outage.
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
        await waitFor(() => {
          expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        });
      });

      it("keeps the composer usable so the user can still send a message", async () => {
        installScenario({
          conversations: [],
          messagesById: {},
          failList: true,
        });
        renderPanel();
        await screen.findByRole("alert");
        // Composer textbox is reachable + enabled (projectId is present).
        const textbox = screen.getByRole("textbox");
        expect(textbox).not.toBeDisabled();
      });
    });

    describe("when the panel is closed", () => {
      it("never arms the list query, so no failure can surface", async () => {
        useLangyStore.setState({ isOpen: false });
        installScenario({
          conversations: [],
          messagesById: {},
          failList: true,
        });
        renderPanel();
        // Give any wrongly-armed query a beat to fire.
        await new Promise((resolve) => setTimeout(resolve, 50));
        // The hook may still RENDER (React calls it), but it must never be
        // ARMED — a disabled query never resolves and so never fails.
        expect(
          spies.listQuery.mock.calls.every(([, enabled]) => !enabled),
        ).toBe(true);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(toaster.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a slow conversations API", () => {
    describe("when the recent list is in flight", () => {
      it("shows a loading indicator until the response resolves", async () => {
        const slow = { resolveLater: () => undefined };
        installScenario({
          conversations: [],
          messagesById: {},
          slowList: slow,
        });
        renderPanel();
        await openHistory();
        expect(
          await screen.findByLabelText(/loading recent/i),
        ).toBeInTheDocument();
        await act(async () => {
          slow.resolveLater();
        });
        await waitFor(() =>
          expect(
            screen.queryByLabelText(/loading recent/i),
          ).not.toBeInTheDocument(),
        );
      });
    });
  });
});

/**
 * The failure the panel used to swallow.
 *
 * The error card, the recovering line and the GitHub connect card all lived
 * INSIDE the `isEmpty ? <EmptyState/> : …` else-branch, so a turn that failed
 * before any message reached the engine — the first send of a fresh chat —
 * rendered the empty state and absolutely nothing else. The user's turn 500'd
 * and the panel said nothing at all.
 */
describe("LangyPanel turn failures", () => {
  describe("given a turn failed before any message reached the thread", () => {
    describe("when the panel renders an empty conversation", () => {
      it("still shows the failure instead of a silent empty state", async () => {
        installScenario({ conversations: [], messagesById: {} });
        chatRef.messages = [];
        chatRef.error = new Error("Internal Server Error");

        renderPanel();

        // SOMETHING must say it broke. A failure may never be quieter than a
        // success, and an empty thread is exactly when it used to be.
        const card = await screen.findByRole("alert");
        expect(card.textContent).toBeTruthy();
      });
    });
  });
});

/**
 * Stop, for a turn this tab did not start.
 * Spec: specs/langy/langy-stop-and-resume.feature (§1)
 *
 * A tab only learns a turn id from its OWN send, so a turn adopted from the
 * durable record — started in another tab, or rejoined after a refresh — used
 * to render a Stop button with nothing behind it: the click moved the control
 * to a disabled "Stopping" spinner and dispatched no request at all, while the
 * agent kept running and kept spending. These tests drive the real panel, so
 * they fail on the panel's WIRING, not just on the resolver's arithmetic.
 */
describe("LangyPanel stopping a turn", () => {
  const conversations = [
    makeConv("conv-live", "Live chat", "2026-05-10T10:00:00.000Z"),
  ];
  const messagesById = {
    "conv-live": [{ id: "m1", role: "user" as const, text: "do the thing" }],
  };

  const stopButton = () => screen.findByRole("button", { name: "Stop" });

  async function openLiveConversation(): Promise<void> {
    renderPanel();
    await openHistory();
    await openRecentOption(/Live chat/i);
  }

  describe("given the durable record names the turn in flight", () => {
    describe("when this tab never started that turn", () => {
      /** @scenario Stopping a turn another tab started really stops it */
      it("dispatches the stop against the turn the record names", async () => {
        installScenario({
          conversations,
          messagesById,
          turnInFlightById: { "conv-live": { turnId: "turn-from-other-tab" } },
        });

        await openLiveConversation();
        await userEvent.click(await stopButton());

        await waitFor(() => {
          expect(spies.stopMutation).toHaveBeenCalledWith({
            projectId: "project-demo",
            conversationId: "conv-live",
            turnId: "turn-from-other-tab",
          });
        });
        // Only now may the control claim a stop is under way.
        expect(
          await screen.findByRole("button", { name: "Stopping" }),
        ).toBeDisabled();
      });
    });
  });

  describe("given a turn is in flight but the record cannot name it yet", () => {
    /** @scenario Stop says nothing it cannot back up */
    it("dispatches nothing and refuses to show it is stopping", async () => {
      installScenario({
        conversations,
        messagesById,
        turnInFlightById: { "conv-live": { turnId: null } },
      });

      await openLiveConversation();
      await userEvent.click(await stopButton());

      expect(spies.stopMutation).not.toHaveBeenCalled();
      // The lie under test: a "Stopping" spinner with no request behind it.
      expect(
        screen.queryByRole("button", { name: "Stopping" }),
      ).not.toBeInTheDocument();
      expect(await stopButton()).toBeEnabled();
      expect(toaster.create).toHaveBeenCalled();
    });
  });

  describe("given the stop request never lands", () => {
    /** @scenario A stop that never reached the backend hands the control back */
    it("hands the control back rather than spinning on a stop nobody is doing", async () => {
      installScenario({
        conversations,
        messagesById,
        turnInFlightById: { "conv-live": { turnId: "turn-from-other-tab" } },
        failStop: true,
      });

      await openLiveConversation();
      await userEvent.click(await stopButton());

      await waitFor(() => expect(spies.stopMutation).toHaveBeenCalled());
      expect(await stopButton()).toBeEnabled();
    });
  });
});
