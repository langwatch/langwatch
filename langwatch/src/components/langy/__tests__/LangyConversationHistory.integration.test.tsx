/**
 * @vitest-environment jsdom
 *
 * Integration tests for LangyPanel conversation history.
 * Spec: specs/assistant/langy-baseline.feature
 *
 * Boundary mocks: useOrganizationTeamProject (project context),
 * @ai-sdk/react useChat (no real streaming), global.fetch (observable
 * conversation API calls). No DB, no MSW.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
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
// Mocks (hoisted by vi.mock — must precede the LangyDrawer import)
// ---------------------------------------------------------------------------

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
};

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatRef.messages,
    sendMessage: chatRef.sendMessage,
    stop: chatRef.stop,
    status: chatRef.status,
    setMessages: chatRef.setMessages,
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

// LangySidebar's per-send model picker pulls three tRPC queries — two from
// the picker wrapper itself (getResolvedDefault + virtualKeys.list) and one
// from the nested ModelSelector (listAllForProjectForFrontend). These tests
// focus on the conversation-history surface, not the picker — boundary-mock
// all three with idle-but-finished queries so React Query thinks they've
// settled. Without this the panel throws "Unable to retrieve application
// context" because no hook is wrapped in a tRPC provider.
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      langyGithub: {
        getConnection: { invalidate: () => Promise.resolve() },
      },
    }),
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
      getConnection: {
        // Feature off in these tests — the header GitHub button hides
        // itself (isLoading=false, data=undefined) and stays out of the way.
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
    },
  },
}));

import { toaster } from "~/components/ui/toaster";
import { LangyDrawer } from "../LangySidebar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

interface ApiConversation {
  id: string;
  title: string | null;
  lastActivityAt: string;
}
interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface UIMessageLike {
  id: string;
  role: string;
  parts?: Array<{ type: string; text?: string }>;
}

function makeConv(
  id: string,
  title: string,
  lastActivityAt: string,
): ApiConversation {
  return { id, title, lastActivityAt };
}

interface FetchScenario {
  conversations: ApiConversation[];
  messagesById: Record<string, ApiMessage[]>;
  failList?: boolean;
  slowList?: { resolveLater: () => void };
}

function installFetchMock(scenario: FetchScenario): Mock {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.startsWith("/api/langy/conversations") && method === "GET") {
        const isList = !/\/conversations\/[^/?]+/.test(url);
        if (isList) {
          if (scenario.failList) {
            return new Response(JSON.stringify({ error: "boom" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (scenario.slowList) {
            await new Promise<void>((resolve) => {
              scenario.slowList!.resolveLater = resolve;
            });
          }
          return new Response(
            JSON.stringify({ conversations: scenario.conversations }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // GET /api/langy/conversations/:id
        const id = url.split("?")[0]!.split("/").pop()!;
        const conv = scenario.conversations.find((c) => c.id === id);
        if (!conv) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
          });
        }
        return new Response(
          JSON.stringify({
            conversation: conv,
            messages: scenario.messagesById[id] ?? [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.startsWith("/api/langy/conversations/") && method === "DELETE") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      return new Response("not stubbed", { status: 501 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel() {
  return render(<LangyDrawer isOpen={true} onOpenChange={() => undefined} />, {
    wrapper: Wrapper,
  });
}

/**
 * History moved behind a header dropdown (RecentChatsMenu) — conversations
 * are only in the DOM while the menu is open. Tests that touch the list
 * open it first. The trigger appearing also doubles as the "list fetch
 * finished with >=1 conversation (or still loading)" signal.
 */
async function openHistory() {
  await userEvent.click(
    await screen.findByRole("button", { name: /recent chats/i }),
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
  (toaster.create as Mock).mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LangyPanel conversation history", () => {
  describe("given existing conversations in the current project", () => {
    const conversations = [
      makeConv("conv-old", "Older chat", "2026-05-01T10:00:00.000Z"),
      makeConv("conv-new", "Newest chat", "2026-05-10T10:00:00.000Z"),
    ];
    const messagesById = {
      "conv-new": [
        { id: "m1", role: "user" as const, content: "hello from newest" },
      ],
      "conv-old": [
        { id: "m2", role: "user" as const, content: "hello from older" },
      ],
    };

    describe("when the panel mounts", () => {
      it("fetches the recent list with the current projectId", async () => {
        const fetchMock = installFetchMock({ conversations, messagesById });
        renderPanel();
        await waitFor(() => {
          const listCall = fetchMock.mock.calls.find(([url]) =>
            String(url).startsWith("/api/langy/conversations?"),
          );
          expect(listCall, "list fetch should fire on mount").toBeTruthy();
          expect(String(listCall![0])).toContain("projectId=project-demo");
        });
      });

      it("loads the most recently active conversation's messages", async () => {
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await waitFor(() => {
          expect(chatRef.setMessages).toHaveBeenCalled();
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          const passed = lastCall?.[0] as UIMessageLike[] | undefined;
          expect(passed?.[0]?.parts?.[0]?.text).toBe("hello from newest");
        });
      });

      it("renders the recent list ordered by last activity (newest first)", async () => {
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await openHistory();
        const list = await screen.findByRole("list", { name: /recent/i });
        const items = within(list).getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("Newest chat");
        expect(items[1]).toHaveTextContent("Older chat");
      });
    });

    describe("when the user clicks a conversation in the recent list", () => {
      it("switches the panel to that conversation's messages", async () => {
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await openHistory();
        const olderItem = await screen.findByRole("button", {
          name: /Older chat/i,
        });
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
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await screen.findByRole("button", { name: /recent chats/i });
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
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await screen.findByRole("button", { name: /recent chats/i });
        await userEvent.click(
          screen.getByRole("button", { name: /new chat/i }),
        );
        await openHistory();
        expect(
          await screen.findByRole("button", { name: /Newest chat/i }),
        ).toBeInTheDocument();
      });
    });

    describe("when the user deletes a conversation", () => {
      it("calls DELETE /api/langy/conversations/:id with the projectId", async () => {
        const fetchMock = installFetchMock({ conversations, messagesById });
        renderPanel();
        await openHistory();
        await screen.findByRole("button", { name: /Older chat/i });
        const olderItem = screen.getByRole("button", { name: /Older chat/i });
        await userEvent.hover(olderItem);
        await userEvent.click(
          within(olderItem.parentElement!).getByRole("button", {
            name: /delete/i,
          }),
        );
        await waitFor(() => {
          const del = fetchMock.mock.calls.find(
            ([url, init]) =>
              String(url).includes("/conversations/conv-old") &&
              (init?.method ?? "GET").toUpperCase() === "DELETE",
          );
          expect(del, "DELETE call should fire").toBeTruthy();
          expect(String(del![0])).toContain("projectId=project-demo");
        });
      });

      it("removes the deleted conversation from the recent list", async () => {
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await openHistory();
        await screen.findByRole("button", { name: /Older chat/i });
        const olderItem = screen.getByRole("button", { name: /Older chat/i });
        await userEvent.hover(olderItem);
        await userEvent.click(
          within(olderItem.parentElement!).getByRole("button", {
            name: /delete/i,
          }),
        );
        await waitFor(() => {
          expect(
            screen.queryByRole("button", { name: /Older chat/i }),
          ).not.toBeInTheDocument();
        });
      });

      it("switches to a fresh conversation if the deleted one was active", async () => {
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await openHistory();
        await screen.findByRole("button", { name: /Newest chat/i });
        // Newest is the active one (most recent). Delete it.
        const newestItem = screen.getByRole("button", {
          name: /Newest chat/i,
        });
        await userEvent.hover(newestItem);
        chatRef.setMessages.mockClear();
        await userEvent.click(
          within(newestItem.parentElement!).getByRole("button", {
            name: /delete/i,
          }),
        );
        await waitFor(() => {
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          expect(lastCall?.[0]).toEqual([]);
        });
      });

      it("aborts any in-flight stream when the active conversation is deleted", async () => {
        installFetchMock({ conversations, messagesById });
        chatRef.status = "streaming";
        renderPanel();
        await openHistory();
        await screen.findByRole("button", { name: /Newest chat/i });
        const newestItem = screen.getByRole("button", {
          name: /Newest chat/i,
        });
        await userEvent.hover(newestItem);
        chatRef.stop.mockClear();
        await userEvent.click(
          within(newestItem.parentElement!).getByRole("button", {
            name: /delete/i,
          }),
        );
        await waitFor(() => {
          expect(chatRef.stop).toHaveBeenCalled();
        });
      });

      it("leaves the active conversation untouched when a different chat is deleted", async () => {
        installFetchMock({ conversations, messagesById });
        renderPanel();
        await openHistory();
        // Wait for initial load to finish so we don't race the seed-load.
        await screen.findByRole("button", { name: /Older chat/i });
        await waitFor(() => {
          const lastCall =
            chatRef.setMessages.mock.calls[
              chatRef.setMessages.mock.calls.length - 1
            ];
          // initial seed loaded Newest's messages
          expect(
            (lastCall?.[0] as UIMessageLike[] | undefined)?.[0]?.parts?.[0]
              ?.text,
          ).toBe("hello from newest");
        });
        // Delete the OLDER (non-active) chat.
        const olderItem = screen.getByRole("button", { name: /Older chat/i });
        await userEvent.hover(olderItem);
        chatRef.setMessages.mockClear();
        chatRef.stop.mockClear();
        await userEvent.click(
          within(olderItem.parentElement!).getByRole("button", {
            name: /delete/i,
          }),
        );
        // Wait until the older chat is removed from the list — proves the
        // delete completed — before asserting we did NOT reset the active.
        await waitFor(() => {
          expect(
            screen.queryByRole("button", { name: /Older chat/i }),
          ).not.toBeInTheDocument();
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
        installFetchMock({
          conversations: [
            makeConv("mine-1", "My only chat", "2026-05-10T10:00:00.000Z"),
          ],
          messagesById: { "mine-1": [] },
        });
        renderPanel();
        await openHistory();
        const list = await screen.findByRole("list", { name: /recent/i });
        const items = within(list).getAllByRole("listitem");
        expect(items).toHaveLength(1);
        expect(items[0]).toHaveTextContent("My only chat");
      });
    });
  });

  describe("given the panel re-mounts in the same project", () => {
    describe("when no explicit conversation is requested", () => {
      it("restores the messages of the last active conversation", async () => {
        const conversations = [
          makeConv("conv-a", "A", "2026-05-09T10:00:00.000Z"),
          makeConv("conv-b", "B", "2026-05-10T10:00:00.000Z"),
        ];
        const messagesById = {
          "conv-a": [{ id: "ma", role: "user" as const, content: "from A" }],
          "conv-b": [{ id: "mb", role: "user" as const, content: "from B" }],
        };
        installFetchMock({ conversations, messagesById });

        const { unmount } = renderPanel();
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
          expect(passed?.[0]?.parts?.[0]?.text).toBe("from B");
        });
      });
    });
  });

  describe("given the projectId changes", () => {
    describe("when the panel re-renders with a new project", () => {
      it("refetches the recent list for the new project", async () => {
        const fetchMock = installFetchMock({
          conversations: [
            makeConv("c1", "demo chat", "2026-05-10T10:00:00.000Z"),
          ],
          messagesById: { c1: [] },
        });
        const { unmount } = renderPanel();
        await waitFor(() => {
          expect(
            fetchMock.mock.calls.some(([url]) =>
              String(url).includes("projectId=project-demo"),
            ),
          ).toBe(true);
        });
        unmount();

        projectRef.current = { id: "project-other", slug: "other" };
        installFetchMock({
          conversations: [
            makeConv("c2", "other chat", "2026-05-10T11:00:00.000Z"),
          ],
          messagesById: { c2: [] },
        });
        renderPanel();
        await openHistory();
        await waitFor(() => {
          expect(
            screen.getByRole("button", { name: /other chat/i }),
          ).toBeInTheDocument();
        });
      });

      it("does not render conversations from the previous project", async () => {
        // First mount: project-demo with "demo chat"
        installFetchMock({
          conversations: [
            makeConv("c1", "demo chat", "2026-05-10T10:00:00.000Z"),
          ],
          messagesById: { c1: [] },
        });
        const { unmount } = renderPanel();
        await screen.findByRole("button", { name: /recent chats/i });
        unmount();

        // Re-mount: project-other with empty list
        projectRef.current = { id: "project-other", slug: "other" };
        installFetchMock({ conversations: [], messagesById: {} });
        renderPanel();
        await waitFor(() => {
          expect(
            screen.queryByRole("button", { name: /demo chat/i }),
          ).not.toBeInTheDocument();
        });
      });
    });
  });

  describe("given the conversations API fails", () => {
    describe("when the panel mounts", () => {
      it("shows an empty state and surfaces an error toast", async () => {
        installFetchMock({
          conversations: [],
          messagesById: {},
          failList: true,
        });
        renderPanel();
        await waitFor(() => {
          expect(toaster.create).toHaveBeenCalled();
          const args = (toaster.create as Mock).mock.calls[0]?.[0];
          expect(args?.type).toBe("error");
        });
        expect(
          screen.queryByRole("list", { name: /recent/i }),
        ).not.toBeInTheDocument();
      });

      it("keeps the composer usable so the user can still send a message", async () => {
        installFetchMock({
          conversations: [],
          messagesById: {},
          failList: true,
        });
        renderPanel();
        await waitFor(() => expect(toaster.create).toHaveBeenCalled());
        // Composer textbox is reachable + enabled (projectId is present).
        const textbox = screen.getByRole("textbox");
        expect(textbox).not.toBeDisabled();
      });
    });
  });

  describe("given a slow conversations API", () => {
    describe("when the recent list is in flight", () => {
      it("shows a loading indicator until the response resolves", async () => {
        const slow = { resolveLater: () => undefined };
        installFetchMock({
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
