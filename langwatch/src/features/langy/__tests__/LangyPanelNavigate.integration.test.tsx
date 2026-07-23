/**
 * @vitest-environment jsdom
 *
 * Agent-driven navigation, at the panel: a `navigate` entry on the live turn
 * stream must move the browser through the SPA router (never a full reload),
 * exactly once per instruction, and only when nothing in the turn actually
 * asked to navigate. Boundary mocks mirror
 * LangyConversationThreading.integration.test.tsx (useChat captures the real
 * transport; the tRPC client is a hand-rolled double at the network
 * boundary) plus a router mock so `router.push` is observable.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    query: {},
    pathname: "/[project]/simulations",
    asPath: "/demo/simulations",
    isReady: true,
  }),
}));

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

// LangySidecar reads a feature flag (peek-dock) at mount. Mock the hook
// directly, matching the sibling panel tests.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("~/components/Markdown", async (importOriginal) => ({
  // Keep the REAL isInternalHref — the panel's navigate handler guards with
  // it, and stubbing the guard would un-test the behavior under test.
  ...(await importOriginal<typeof import("~/components/Markdown")>()),
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
        messages: { invalidate: () => Promise.resolve() },
      },
      langyGithub: { getInstallStatus: { invalidate: () => Promise.resolve() } },
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
      disconnect: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
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
      stopTurn: {
        useMutation: () => ({
          mutate: () => undefined,
          mutateAsync: () => Promise.resolve(),
          isPending: false,
        }),
      },
      deleteConversation: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      renameConversation: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      forkConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve({ id: "forked" }) }),
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
        useQuery: () => ({ data: { model: "openai/gpt-5-mini" }, isLoading: false }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: { providers: [] }, isLoading: false }),
      },
    },
    virtualKeys: { list: { useQuery: () => ({ data: undefined, isLoading: false }) } },
    // useProjectReach (mounted by LangySidecar) reads the onboarding checks.
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
        useQuery: () => ({ data: { scope: { kind: "none" } }, isLoading: false }),
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

const sendOptions = {
  messages: [
    { id: "message-1", role: "user", parts: [{ type: "text", text: "show me a run" }] },
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
  mutation.mockResolvedValue({ conversationId: "conv-1", turnId: "turn-1" });
  subscription.mockClear();
  pushMock.mockClear();
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

describe("Feature: Langy opens the resource it surfaced in the browser", () => {
  describe("Rule: Langy navigates only when I asked to be taken somewhere", () => {
    describe("given I ask Langy to show me one of the scenario runs", () => {
      /** @scenario "Asking Langy to show a scenario run opens it in place" */
      it("the browser lands on that run's detail view via the SPA router", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
        });

        expect(pushMock).toHaveBeenCalledWith(
          "/demo/simulations/set_1/batch_1?openRun=run_1",
        );
        // …and the move tore nothing down: the panel is still open with the
        // SAME live subscription — no remount, no re-subscribe, conversation
        // intact.
        expect(useLangyStore.getState().isOpen).toBe(true);
        expect(subscription).toHaveBeenCalledTimes(1);
        const { unsubscribe } = subscription.mock.results.at(-1)!.value as {
          unsubscribe: ReturnType<typeof vi.fn>;
        };
        expect(unsubscribe).not.toHaveBeenCalled();
      });
    });

    describe("given I ask Langy to list recent scenario runs (no open intent)", () => {
      /** @scenario "Surfacing resources without an open intent does not navigate" */
      it("the browser stays on the page I was on — no navigate entry, no push", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({ type: "delta", text: "Here are your runs." });
          latestOnData()({ type: "end" });
        });

        expect(pushMock).not.toHaveBeenCalled();
      });
    });

    describe("given Langy could not look up the resource with my own access", () => {
      /** @scenario "Langy only navigates to resources reachable with my own access" */
      it("the browser does not navigate, and the answer still renders", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        // The denied lookup arrives as a failed tool call and an apologetic
        // answer — and NO navigate entry: the relay only caches links from
        // lookups the viewer's own access could complete (pinned by the
        // failed-lookup and forged-stdout tests in
        // langyTurnRelay.unit.test.ts), so there is nothing to navigate with.
        act(() => {
          latestOnData()({
            type: "tool",
            id: "call-1",
            name: "bash",
            phase: "end",
            isError: true,
            output: "Error: 403 — you do not have access to this resource",
          });
          latestOnData()({
            type: "delta",
            text: "I couldn't open that — your account can't see it.",
          });
          latestOnData()({ type: "end" });
        });

        expect(pushMock).not.toHaveBeenCalled();
        expect(useLangyStore.getState().isOpen).toBe(true);
      });
    });
  });

  describe("Rule: Agent navigation is SPA-safe and never tears the panel down", () => {
    describe("when Langy navigates me to a resource it surfaced", () => {
      /** @scenario "An agent-driven navigation keeps the panel and conversation mounted" */
      it("keeps the same live subscription mounted — the in-flight response keeps streaming", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({ type: "delta", text: "Here's the run: " });
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
          // The turn keeps going right through the navigate — no exception,
          // no early close, and the subscription is exactly the one opened
          // (the panel/transport never remounted).
          latestOnData()({ type: "delta", text: "it passed." });
          latestOnData()({ type: "end" });
        });

        expect(pushMock).toHaveBeenCalledTimes(1);
        expect(subscription).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("Rule: Navigation is a live-edge instruction, fired at most once", () => {
    describe("given a turn's live stream is replayed after a reconnect", () => {
      it("navigates the browser at most once for the same instruction", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

        act(() => {
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
          // A redelivered tail hands the client the exact same entry again.
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
        });

        expect(pushMock).toHaveBeenCalledTimes(1);
      });
    });

    describe("given a NEW turn starts", () => {
      it("clears the dedup so the same destination can be navigated to again", async () => {
        renderPanel();
        await waitFor(() => expect(transportRef.current).not.toBeNull());

        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));
        act(() => {
          latestOnData()({ type: "navigate", href: "/demo/simulations" });
        });
        expect(pushMock).toHaveBeenCalledTimes(1);

        mutation.mockResolvedValueOnce({ conversationId: "conv-1", turnId: "turn-2" });
        await act(async () => {
          await transportRef.current!.sendMessages(sendOptions);
        });
        await waitFor(() => expect(subscription).toHaveBeenCalledTimes(2));
        act(() => {
          latestOnData()({ type: "navigate", href: "/demo/simulations" });
        });

        expect(pushMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("Rule: a navigate entry that is not a same-app path never moves the browser", () => {
    // The relay only ever resolves same-origin relative hrefs, but the panel's
    // `isInternalHref` guard is the last line of defence before `router.push`
    // runs — a redelivered/forged entry must not push. Feeding a real
    // off-site-in-disguise href locks that guard: delete it and this goes red.
    it.each([
      ["a protocol-relative host", "//evil.example.com/steal"],
      ["a backslash-disguised host", "/\\evil.example.com"],
      ["an absolute off-site url", "https://evil.example.com/steal"],
    ])("does not push for %s", async (_label, href) => {
      renderPanel();
      await waitFor(() => expect(transportRef.current).not.toBeNull());
      await act(async () => {
        await transportRef.current!.sendMessages(sendOptions);
      });
      await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));

      act(() => {
        latestOnData()({ type: "navigate", href });
      });

      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
