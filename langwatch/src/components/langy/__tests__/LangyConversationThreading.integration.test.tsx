/**
 * @vitest-environment jsdom
 *
 * Regression for #4748: the sidebar must thread the active conversation id
 * into every /api/langy/chat send, and adopt the id the server returns in
 * `x-langy-conversation-id` — otherwise each message forks a brand-new
 * conversation (and a brand-new OpenCode worker, which is keyed by
 * conversation id), silently breaking multi-turn memory.
 *
 * Boundary mocks mirror LangyConversationHistory.integration.test.tsx:
 * useOrganizationTeamProject, @ai-sdk/react useChat (sendMessage spy),
 * the `ai` DefaultChatTransport (captures the transport options so the
 * header-adoption fetch wrapper is testable), and global.fetch.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
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

// Capture the options LangySidebar passes to the transport so the test can
// drive its custom `fetch` (the header-adoption wrapper) directly.
const transportOptionsRef = {
  current: null as null | { api: string; fetch?: typeof fetch },
};

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(opts: { api: string; fetch?: typeof fetch }) {
      transportOptionsRef.current = opts;
    }
  },
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({ data: undefined, isLoading: false }),
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
  },
}));

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

function installFetchMock(conversations: ApiConversation[]): Mock {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.startsWith("/api/langy/chat") && method === "POST") {
        return new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-langy-conversation-id": "conv-created-by-server",
          },
        });
      }

      if (url.startsWith("/api/langy/conversations") && method === "GET") {
        const isList = !/\/conversations\/[^/?]+/.test(url);
        if (isList) {
          return new Response(JSON.stringify({ conversations }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        const id = url.split("?")[0]!.split("/").pop()!;
        const conv = conversations.find((c) => c.id === id);
        if (!conv) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
          });
        }
        return new Response(
          JSON.stringify({ conversation: conv, messages: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
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

async function sendFromComposer(text: string) {
  const textbox = screen.getByRole("textbox");
  await userEvent.type(textbox, text);
  await userEvent.keyboard("{Enter}");
}

function lastSendBody(): Record<string, unknown> {
  const calls = chatRef.sendMessage.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const options = calls[calls.length - 1]![1] as {
    body: Record<string, unknown>;
  };
  return options.body;
}

beforeEach(() => {
  projectRef.current = { id: "project-demo", slug: "demo" };
  chatRef.messages = [];
  chatRef.status = "ready";
  chatRef.sendMessage.mockReset();
  chatRef.setMessages.mockReset();
  transportOptionsRef.current = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Langy conversation threading", () => {
  describe("given an active restored conversation", () => {
    const conversations = [
      {
        id: "conv-active",
        title: "Active chat",
        lastActivityAt: "2026-06-01T10:00:00.000Z",
      },
    ];

    describe("when the user sends a message", () => {
      it("includes the active conversationId in the chat body so the send stays in the same conversation", async () => {
        installFetchMock(conversations);
        renderPanel();
        // Wait for the restore (conv-active becomes current).
        await waitFor(() => expect(chatRef.setMessages).toHaveBeenCalled());

        await sendFromComposer("second turn");

        expect(lastSendBody()).toMatchObject({
          projectId: "project-demo",
          conversationId: "conv-active",
        });
      });
    });
  });

  describe("given a fresh project with no conversations", () => {
    describe("when the first send completes and the server returns x-langy-conversation-id", () => {
      it("adopts the server's conversation id and threads it into the next send", async () => {
        installFetchMock([]);
        renderPanel();
        await waitFor(() =>
          expect(transportOptionsRef.current?.fetch).toBeTypeOf("function"),
        );

        // First send: no active conversation yet → no conversationId.
        await sendFromComposer("first turn");
        expect(lastSendBody().conversationId).toBeUndefined();

        // Drive the transport's fetch wrapper the way useChat would: it hits
        // /api/langy/chat, whose mocked response carries the header.
        await act(async () => {
          await transportOptionsRef.current!.fetch!("/api/langy/chat", {
            method: "POST",
            body: "{}",
          });
        });

        await sendFromComposer("second turn");
        await waitFor(() => {
          expect(lastSendBody()).toMatchObject({
            conversationId: "conv-created-by-server",
          });
        });
      });
    });
  });
});
