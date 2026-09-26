/**
 * @vitest-environment jsdom
 *
 * The latency chip on the empty state must pin the "how-do-i" skill on the
 * turn it sends — live runs showed gpt-5-mini sometimes skip loading the
 * skill when the prompt is only text. This exercises the whole path a real
 * click takes: EmptyState's onPick -> LangyPanel's send -> turnContextRef ->
 * the transport's outgoing turn body.
 *
 * Boundary mocks mirror LangyPanelUiActions.integration.test.tsx, except
 * `useChat`'s `sendMessage` here delegates into the REAL transport
 * (`transportRef.current.sendMessages`) instead of stopping at a bare spy —
 * exactly what `@ai-sdk/react` does in production — so a click's effect on
 * the outgoing mutation body is actually observable.
 *
 * @see specs/langy/langy-how-do-i-latency.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatTransport, UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    query: {},
    pathname: "/[project]/experiments",
    asPath: "/demo/experiments",
    isReady: true,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-demo", slug: "demo" },
    organization: { id: "org-demo" },
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

const transportRef = {
  current: null as ChatTransport<UIMessage> | null,
};

vi.mock("@ai-sdk/react", () => ({
  // A click must go through the SAME path a real send does — `useChat`'s
  // `sendMessage` hands the message straight to the transport. A bare spy
  // here would prove only that the panel calls `sendMessage`, never that the
  // skill actually reaches the outgoing turn body.
  useChat: (options: { transport: ChatTransport<UIMessage> }) => {
    transportRef.current = options.transport;
    return {
      messages: [],
      sendMessage: (message: { role: string; parts: unknown[] }) =>
        options.transport.sendMessages({
          messages: [{ id: "m1", ...message }],
        } as unknown as Parameters<
          ChatTransport<UIMessage>["sendMessages"]
        >[0]),
      stop: vi.fn(),
      status: "ready" as const,
      setMessages: vi.fn(),
    };
  },
}));

const mutation = vi.fn();
const subscription = vi.fn(
  (_path: string, _input: unknown, _options: unknown) => ({
    unsubscribe: vi.fn(),
  }),
);

vi.mock("~/utils/api", () => ({
  trpcClient: {
    langy: {
      createConversation: {
        mutate: (input: unknown) => mutation("langy.createConversation", input),
      },
      continueConversation: {
        mutate: (input: unknown) =>
          mutation("langy.continueConversation", input),
      },
      onTurnStream: {
        subscribe: (input: unknown, options: unknown) =>
          subscription("langy.onTurnStream", input, options),
      },
    },
  },
  api: {
    useUtils: () => ({
      langy: {
        list: { invalidate: () => Promise.resolve() },
        messages: { invalidate: () => Promise.resolve() },
      },
      github: {
        getConnectionStatus: { invalidate: () => Promise.resolve() },
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
    github: {
      getConnectionStatus: {
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
      onConversationUpdate: { useSubscription: () => undefined },
      warmWorker: {
        useMutation: () => ({ mutate: () => undefined }),
      },
      getLocalWorkspace: {
        useQuery: () => ({ data: undefined, refetch: () => undefined }),
      },
      localRecord: {
        useQuery: () => ({ data: undefined, refetch: () => undefined }),
      },
      answerQuestion: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
      stopTurn: {
        useMutation: () => ({
          mutate: () => undefined,
          mutateAsync: () => Promise.resolve(),
          isPending: false,
        }),
      },
      deleteConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      renameConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      forkConversation: {
        useMutation: () => ({
          mutateAsync: () => Promise.resolve({ id: "forked" }),
        }),
      },
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ items: [], nextCursor: null }] },
          isLoading: false,
          isFetching: false,
          isPlaceholderData: false,
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
      setRoleAssignmentForScope: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      setFeatureOverrideForScope: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
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
    integrationsChecks: {
      getCheckStatus: {
        useQuery: () => ({
          data: {
            firstMessage: true,
            onlineEvaluations: 1,
            simulations: 1,
            datasets: 1,
          },
          isLoading: false,
        }),
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

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

function renderPanel() {
  return render(<LangySidecar />, { wrapper: Wrapper });
}

beforeEach(() => {
  transportRef.current = null;
  mutation.mockReset();
  mutation.mockResolvedValue({ conversationId: "conv-1", turnId: "turn-1" });
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

describe("Feature: the empty state's latency chip pins the how-do-i skill", () => {
  describe("given the empty state is showing", () => {
    describe('when the reader clicks "How do I improve my agent\'s latency?"', () => {
      /** @scenario "The empty state offers the latency question" */
      it("carries the how-do-i skill on the outgoing turn", async () => {
        renderPanel();
        const user = userEvent.setup();

        await user.click(
          await screen.findByText("How do I improve my agent's latency?"),
        );

        await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
        const [, input] = mutation.mock.calls[0]!;
        expect(input).toMatchObject({
          skills: [{ id: "how-do-i", label: "how-do-i" }],
        });
      });
    });

    describe("when the reader clicks a suggestion with no skill", () => {
      it("carries no skills on the outgoing turn", async () => {
        renderPanel();
        const user = userEvent.setup();

        await user.click(await screen.findByText("Find failing traces"));

        await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
        const [, input] = mutation.mock.calls[0]!;
        expect(input).not.toHaveProperty("skills");
      });
    });
  });
});
