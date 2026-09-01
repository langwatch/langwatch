/**
 * @vitest-environment jsdom
 *
 * Agent-driven page control, at the panel: a `ui` entry on the live turn
 * stream reaches the page's own handler through a claim, and the rollout flag
 * is what closes that channel. Boundary mocks mirror
 * LangyPanelNavigate.integration.test.tsx (useChat captures the real
 * transport; the tRPC client is a hand-rolled double at the network boundary)
 * plus a feature-flag double the test drives per flag key.
 *
 * @see specs/langy/langy-ui-actions.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  type LangyUiActionHandlers,
  useLangyStore,
} from "@langwatch/langy-web";

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

// The panel reads two flags: the peek dock and the UI-action channel. This
// double answers per key so a test can close the channel and leave the rest of
// the panel as it was.
const flagsRef = {
  current: { release_langy_ui_actions: true } as Record<string, boolean>,
};
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled: flagsRef.current[flag] ?? false,
    isLoading: false,
  }),
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
const claimUiAction = vi.fn(async (_input: unknown) => ({ isClaimed: true }));
const completeUiAction = vi.fn(async (_input: unknown) => ({
  isAccepted: true,
}));
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
      claimUiAction: { mutate: (input: unknown) => claimUiAction(input) },
      completeUiAction: { mutate: (input: unknown) => completeUiAction(input) },
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
        useQuery: () => ({ data: [], isLoading: false }),
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

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

const run = vi.fn(() => ({ targetId: "target-2" }));

/** A page that handles the dispatched kind, so only the flag can stop it. */
const handlersRef = {
  current: {
    "workbench.duplicateTarget": {
      payloadSchema: z.object({ targetId: z.string() }),
      run,
    },
  } as LangyUiActionHandlers,
};

function renderPanel() {
  return render(<LangySidecar actionHandlersRef={handlersRef} />, {
    wrapper: Wrapper,
  });
}

const sendOptions = {
  messages: [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "duplicate that column" }],
    },
  ],
} as unknown as Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];

const UI_ENTRY = {
  type: "ui",
  actionId: "action-1",
  kind: "workbench.duplicateTarget",
  payload: { targetId: "target-1" },
};

beforeEach(() => {
  flagsRef.current = { release_langy_ui_actions: true };
  chatRef.messages = [];
  chatRef.status = "ready";
  chatRef.sendMessage.mockReset();
  chatRef.setMessages.mockReset();
  transportRef.current = null;
  mutation.mockReset();
  mutation.mockResolvedValue({ conversationId: "conv-1", turnId: "turn-1" });
  subscription.mockClear();
  claimUiAction.mockClear();
  completeUiAction.mockClear();
  run.mockClear();
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

/** The `onData` handler the transport most recently handed a subscription. */
function latestOnData(): (entry: unknown) => void {
  const call = subscription.mock.calls.at(-1)!;
  const opts = call[2] as { onData: (entry: unknown) => void };
  return opts.onData;
}

/** Mount the panel and start a turn, so the live stream is open. */
async function startTurn() {
  const rendered = renderPanel();
  await waitFor(() => expect(transportRef.current).not.toBeNull());
  await act(async () => {
    await transportRef.current!.sendMessages(sendOptions);
  });
  await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));
  return rendered;
}

describe("Feature: Langy drives the open page through typed UI actions", () => {
  describe("Rule: the page executes the action the agent dispatched", () => {
    describe("given the page handles the dispatched kind", () => {
      describe("when the action arrives on the turn's stream", () => {
        it("claims the action and runs the page's handler", async () => {
          await startTurn();

          act(() => {
            latestOnData()(UI_ENTRY);
          });

          await waitFor(() => expect(claimUiAction).toHaveBeenCalledTimes(1));
          // The turn is not part of the claim: the page and the dispatch read
          // the conversation's current turn from records that settle at
          // different moments, and a claim refused on that difference sent
          // live work to the backend with the page open.
          expect(claimUiAction).toHaveBeenCalledWith({
            projectId: "project-demo",
            conversationId: "conv-1",
            actionId: "action-1",
          });
          await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        });
      });
    });
  });

  describe("Rule: page control is switched off by its rollout flag", () => {
    describe("given page control was switched off before the action arrived", () => {
      describe("when the action arrives on the turn's stream", () => {
        /** @scenario "With page control rolled back, the open page ignores dispatched actions" */
        it("never claims the action, and the page's handler never runs", async () => {
          const { rerender } = await startTurn();

          // The flag flips mid-turn: the panel is already mounted and the
          // transport is memoised, so this is the case the ref exists for.
          flagsRef.current = { release_langy_ui_actions: false };
          rerender(<LangySidecar actionHandlersRef={handlersRef} />);

          act(() => {
            latestOnData()(UI_ENTRY);
          });
          // Let anything the dispatch would have started settle first.
          await act(async () => {
            await Promise.resolve();
          });

          expect(claimUiAction).not.toHaveBeenCalled();
          expect(completeUiAction).not.toHaveBeenCalled();
          expect(run).not.toHaveBeenCalled();
        });
      });
    });
  });
});
