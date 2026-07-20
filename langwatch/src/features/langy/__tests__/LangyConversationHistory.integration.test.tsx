/**
 * @vitest-environment jsdom
 *
 * Integration tests for LangyPanel conversation history.
 * Spec: specs/langy/langy-baseline.feature
 *
 * Boundary mocks: useOrganizationTeamProject (project context),
 * @ai-sdk/react useChat (no real streaming), and the ~/utils/api tRPC surface
 * (an in-memory stand-in that serves the real DTO shapes). No REST fetch, no
 * DB, no MSW — the whole Langy conversation surface goes through tRPC now, so
 * the mock does too.
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// Shared fixtures + observation state
//
// Declared at top level so the hoisted vi.mock factory below closes over them
// (the same mechanism the existing projectRef / chatRef mocks rely on): the
// factory only runs when ~/utils/api is first imported — by which point these
// are live — and reads them on every render.
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
}

const scenarioRef: { current: Scenario } = {
  current: {
    conversations: [],
    messagesById: {},
    failList: false,
    slowList: null,
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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: projectRef.current }),
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
};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatRef.messages,
    sendMessage: chatRef.sendMessage,
    stop: chatRef.stop,
    status: chatRef.status,
    setMessages: chatRef.setMessages,
    error: null,
    clearError: chatRef.clearError,
    regenerate: chatRef.regenerate,
  }),
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(public opts: unknown) {}
  },
}));

// @paper-design/shaders-react requires WebGL, which jsdom does not provide.
// MeshGradient is purely cosmetic — stub it out so Stage C's animated AI
// cues don't spam the test output with unhandled "WebGL is not supported"
// errors. Same pattern used in SearchBar.integration.test.tsx.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

// The whole Langy tRPC surface, served from `scenarioRef`. Each procedure
// returns the exact shape the real router returns — `langy.list` yields
// `{ items }` of list rows, `langy.messages` yields `{ messages, lastError,
// isTurnInFlight }` with real `parts`, `deleteConversation` archives + drives
// the invalidation channel. The model-picker queries are stubbed idle-but-
// finished so React Query treats them as settled (else the panel throws
// "Unable to retrieve application context" with no tRPC provider).
vi.mock("~/utils/api", async () => {
  const React = await import("react");

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
      (notify) => {
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
      // isInitialLoading, not isLoading: React Query v4 reports a DISABLED
      // query as status "loading" forever, and the panel deliberately disables
      // the list while closed — so the production hook reads isInitialLoading.
      // Mirror that: only a query that is BOTH enabled AND still loading counts.
      isInitialLoading: enabled && state.status === "loading",
      isLoading: enabled && state.status === "loading",
      isFetching: enabled && state.status === "loading",
      isPreviousData: false,
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
      (notify) => {
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
      isInitialLoading:
        enabled && state.status === "loading" && state.data === undefined,
      isLoading: enabled && state.status === "loading",
      isFetching: enabled && state.status === "loading",
      isPreviousData: state.status === "loading" && state.data !== undefined,
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
  // list.invalidate does real work (drives the recents refresh after a delete);
  // the rest exist so useLangyFreshness's SSE handler can reference them without
  // throwing at render — that handler never runs here (no SSE data).
  const trpcUtils = {
    langy: {
      list: {
        getData: () => undefined,
        setData: () => undefined,
        getInfiniteData: () => undefined,
        setInfiniteData: () => undefined,
        cancel: () => Promise.resolve(),
        invalidate: (input?: unknown) => {
          spies.listInvalidate(input);
          bumpList();
          return Promise.resolve();
        },
      },
      messages: {
        invalidate: () => Promise.resolve(),
      },
      detail: {
        setData: () => undefined,
      },
    },
    langyGithub: {
      getInstallStatus: { invalidate: () => Promise.resolve() },
    },
  };

  // Peripheral menus in the panel header (Foundry/ops permission, etc.) each
  // pull their own tRPC queries that these tests don't care about. Rather than
  // enumerate every one, a recursive proxy answers any UNMOCKED router with a
  // settled-idle query / no-op mutation / no-op subscription. The langy surface
  // and the model-picker below stay explicit; everything else is inert.
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
      get: (_t, prop) => {
        if (prop === "useQuery" || prop === "useInfiniteQuery")
          return idleQuery;
        if (prop === "useMutation") return noopMutation;
        if (prop === "useSubscription") return () => undefined;
        return routerProxy;
      },
    },
  );

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
              isTurnInFlight: false,
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
      forkConversation: {
        useMutation: () => ({
          mutateAsync: async (variables: {
            projectId: string;
            conversationId: string;
          }) => ({
            id: `${variables.conversationId}-fork`,
            title: "Forked chat",
            isShared: false,
            isOwn: true,
            messageCount: 0,
            lastActivityAtMs: 0,
            status: "idle",
          }),
          isPending: false,
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
    modelProvider: {
      getResolvedDefault: {
        // A resolved model is configured: these tests exercise conversation
        // history on a usable Langy, so langyNeedsModel must be false (else
        // LangySidebar renders the inline model-setup screen over the panel).
        useQuery: () => ({
          data: { model: "openai/gpt-5-mini" },
          isLoading: false,
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: { providers: [] },
          isLoading: false,
        }),
      },
    },
    virtualKeys: {
      list: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
    langyGithub: {
      getInstallStatus: {
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

  const apiHandler: ProxyHandler<Record<string, unknown>> = {
    get: (target, prop) =>
      prop in target ? target[prop as string] : (routerProxy as never),
  };

  return { api: new Proxy(explicitApi, apiHandler) };
});

import { toaster } from "~/components/ui/toaster";
import { LangySidecar } from "../components/LangyPanel";
import { LangyProvider } from "../LangyContext";
import { useLangyStore } from "../stores/langyStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The panel reads its per-page registration context (proposal handlers, page
// context chips) from LangyProvider — the real app mounts it in
// ProjectLangyLayout, so the test does too.
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
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
  };
  return spies;
}

function renderPanel() {
  return render(<LangySidecar />, {
    wrapper: Wrapper,
  });
}

/**
 * The recents dropdown is re-parented onto the header title button. Chakra's
 * combobox supplies that trigger's accessible name ("Toggle suggestions"), so
 * tests address the control by that name instead of its changing visible title.
 * Conversations are only in the DOM while the menu is open.
 */
const recentsTrigger = () =>
  screen.findByRole("button", { name: "Toggle suggestions" });

async function openHistory() {
  await userEvent.click(await recentsTrigger());
}

function recentOption(pattern: RegExp): HTMLElement | undefined {
  return screen
    .queryAllByRole("option")
    .find((option) => pattern.test(option.textContent ?? ""));
}

async function findRecentOption(pattern: RegExp): Promise<HTMLElement> {
  let option: HTMLElement | undefined;
  await waitFor(() => {
    option = recentOption(pattern);
    expect(option).toBeDefined();
  });
  return option!;
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
  (toaster.create as Mock).mockReset();
  spies.listQuery.mockReset();
  spies.deleteMutation.mockReset();
  spies.listInvalidate.mockReset();
  scenarioRef.current = {
    conversations: [],
    messagesById: {},
    failList: false,
    slowList: null,
  };
  // These suites exercise an OPEN panel; a closed panel deliberately never
  // fetches the recents list (see useLangyConversationListQuery).
  useLangyStore.setState({ isOpen: true });
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
        const list = await screen.findByRole("listbox");
        const items = within(list).getAllByRole("option");
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
          expect(screen.getAllByRole("option")).toHaveLength(30);
        });
        expect(recentOption(/Needle archive/i)).toBeUndefined();

        await userEvent.click(
          screen.getByRole("button", {
            name: "Load older conversations",
          }),
        );

        await waitFor(() => {
          expect(screen.getAllByRole("option")).toHaveLength(35);
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
        const olderItem = await findRecentOption(/Older chat/i);
        chatRef.setMessages.mockClear();
        await userEvent.click(olderItem);
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
        await userEvent.click(await findRecentOption(/Newest chat/i));
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
        await userEvent.click(await findRecentOption(/Newest chat/i));
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
        await userEvent.click(await findRecentOption(/Newest chat/i));
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
        const list = await screen.findByRole("listbox");
        const items = within(list).getAllByRole("option");
        expect(items).toHaveLength(1);
        expect(items[0]).toHaveTextContent("My only chat");
      });
    });
  });

  describe("given the panel re-mounts in the same project", () => {
    describe("when no explicit conversation is requested", () => {
      it("returns to a fresh state instead of restoring a prior selection", async () => {
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
        await userEvent.click(
          // The option's a11y name folds in the row's "Delete conversation"
          // button label, so anchor only the start.
          await findRecentOption(/^B/),
        );
        await waitFor(() => {
          const passed = chatRef.setMessages.mock.calls[
            chatRef.setMessages.mock.calls.length - 1
          ]?.[0] as UIMessageLike[] | undefined;
          expect(passed?.[0]?.parts?.[0]?.text).toBe("from B");
        });
        unmount();
        chatRef.setMessages.mockClear();

        renderPanel();
        await waitFor(() => {
          const passed = chatRef.setMessages.mock.calls[
            chatRef.setMessages.mock.calls.length - 1
          ]?.[0] as UIMessageLike[] | undefined;
          expect(passed).toEqual([]);
        });
        expect(useLangyStore.getState().activeConversationId).toBeNull();
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
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

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
