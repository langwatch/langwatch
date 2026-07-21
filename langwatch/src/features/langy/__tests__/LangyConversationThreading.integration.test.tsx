/**
 * @vitest-environment jsdom
 *
 * Regression for #4748: the sidebar must thread the active conversation id
 * into every tRPC turn-start mutation, and adopt the id createConversation
 * returns — otherwise each message forks a brand-new conversation (and a
 * brand-new OpenCode worker, which is keyed by conversation id), silently
 * breaking multi-turn memory.
 *
 * Boundary mocks mirror LangyConversationHistory.integration.test.tsx:
 * useOrganizationTeamProject, @ai-sdk/react useChat (captures the custom
 * transport), and the tRPC client used at the network boundary.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    mutation(path: string, input: unknown) {
      return mutation(path, input);
    },
    subscription(path: string, input: unknown, options: unknown) {
      return subscription(path, input, options);
    },
  },
  api: {
    useUtils: () => ({
      langy: {
        list: { invalidate: () => Promise.resolve() },
      },
      langyGithub: {
        getInstallStatus: { invalidate: () => Promise.resolve() },
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
    langyGithub: {
      getInstallStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
    },
    langy: {
      messages: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
      modelsAllowed: {
        useQuery: () => ({
          data: { modelsAllowed: null },
          isLoading: false,
          isError: false,
        }),
      },
      onConversationUpdate: {
        useSubscription: () => undefined,
      },
      stopTurn: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      deleteConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      renameConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      stopTurn: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: [], nextCursor: null }] },
          isInitialLoading: false,
          isFetching: false,
          isPreviousData: false,
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
      getResolvedDefault: {
        // A resolved model is configured: these tests exercise conversation
        // threading on a usable Langy, so langyNeedsModel must be false (else
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

function renderPanel() {
  return render(<LangySidecar />, {
    wrapper: Wrapper,
  });
}

const transportSendOptions = {
  messages: [
    { id: "message-1", role: "user", parts: [{ type: "text", text: "hi" }] },
  ],
} as unknown as Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];

beforeEach(() => {
  projectRef.current = { id: "project-demo", slug: "demo" };
  chatRef.messages = [];
  chatRef.status = "ready";
  chatRef.sendMessage.mockReset();
  chatRef.setMessages.mockReset();
  transportRef.current = null;
  mutation.mockReset();
  mutation.mockResolvedValue({
    conversationId: "conv-created-by-server",
    turnId: "turn-created-by-server",
  });
  subscription.mockClear();
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

describe("Langy conversation threading", () => {
  describe("given an active restored conversation", () => {
    describe("when the user sends a message", () => {
      it("includes the active conversationId in the chat body so the send stays in the same conversation", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        act(() => {
          useLangyStore.getState().selectConversation("conv-active");
        });
        await waitFor(() => {
          expect(useLangyStore.getState().activeConversationId).toBe(
            "conv-active",
          );
        });
        await act(async () => {
          await transportRef.current!.sendMessages(transportSendOptions);
        });

        expect(mutation).toHaveBeenCalledWith(
          "langy.continueConversation",
          expect.objectContaining({
            projectId: "project-demo",
            conversationId: "conv-active",
          }),
        );
      });
    });
  });

  describe("given a fresh project with no conversations", () => {
    describe("when the first send completes and the server returns x-langy-conversation-id", () => {
      it("adopts the server's conversation id and threads it into the next send", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());

        // First send: no active conversation yet → no conversationId.
        await act(async () => {
          await transportRef.current!.sendMessages(transportSendOptions);
        });
        expect(mutation.mock.calls[0]?.[0]).toBe("langy.createConversation");
        expect(mutation.mock.calls[0]?.[1]).not.toHaveProperty(
          "conversationId",
        );
        await waitFor(() => {
          expect(useLangyStore.getState().activeConversationId).toBe(
            "conv-created-by-server",
          );
        });

        await act(async () => {
          await transportRef.current!.sendMessages(transportSendOptions);
        });
        expect(mutation).toHaveBeenLastCalledWith(
          "langy.continueConversation",
          expect.objectContaining({
            conversationId: "conv-created-by-server",
          }),
        );
      });
    });
  });
});
