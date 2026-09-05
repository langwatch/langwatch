/**
 * Agent-driven navigation, at the panel: a `navigate` entry on the live turn stream must move the browser through the SPA router (never a full reload), and only when the turn actually asked to navigate.
 * @vitest-environment jsdom
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage } from "ai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    currentDrawer: undefined,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
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
      error: undefined,
      clearError: vi.fn(),
      regenerate: vi.fn(),
    };
  },
}));

const mutation = vi.fn();
const subscription = vi.fn((_input: unknown, _options: unknown) => ({
  unsubscribe: vi.fn(),
}));

vi.mock("../../../../../behavior/langy-api", async () => {
  const { createTrpcUtils, idleQuery, withFallback } =
    await import("../../../__tests__/support/langy-api-mock");

  const trpcUtils = createTrpcUtils();

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: { pages: [{ items: [], nextCursor: null }] },
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
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
      stopTurn: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: { model: "openai/gpt-5-mini" },
          isLoading: false,
          isSuccess: true,
          isError: false,
          refetch: () => Promise.resolve(),
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: { providers: [] }, isLoading: false }),
      },
      setRoleAssignmentForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      setFeatureOverrideForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
    },
    virtualKeys: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
  };

  return {
    api: withFallback(explicitApi),
    trpcClient: {
      langy: {
        createConversation: {
          mutate: (input: unknown) => mutation("langy.createConversation", input),
        },
        continueConversation: {
          mutate: (input: unknown) => mutation("langy.continueConversation", input),
        },
        onTurnStream: {
          subscribe: (input: unknown, options: unknown) => subscription(input, options),
        },
      },
    },
  };
});

import { LangySidecar } from "../langy-panel";
import { LangyProvider } from "../langy-context";
import { useLangyStore } from "../../../../../index";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host";
import { UiCapabilityContextProvider } from "@langwatch/ui-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/ui-host/testing";

const PROJECT_ID = "project-demo";
const navigateMock = vi.fn();

class FakeLangyHost extends LangyHostPort {
  project() {
    return { id: PROJECT_ID, slug: "demo", name: "demo" };
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
  isDemoProject() {
    return false;
  }
  featureFlag() {
    return false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/demo/experiments" };
  }
  setQuery() {}
  navigate(to: string) {
    navigateMock(to);
  }
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}
const host = new FakeLangyHost();

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <UiCapabilityContextProvider value={createUiCapabilitiesFromHost(host)}>
      <LangyHostProvider value={host}>
        <LangyProvider>{children}</LangyProvider>
      </LangyHostProvider>
    </UiCapabilityContextProvider>
  </ChakraProvider>
);

function renderPanel() {
  return render(<LangySidecar />, { wrapper: Wrapper });
}

const sendOptions = {
  messages: [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "show me a run" }],
    },
  ],
} as unknown as Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];

beforeEach(() => {
  chatRef.messages = [];
  chatRef.status = "ready";
  chatRef.sendMessage.mockReset();
  chatRef.setMessages.mockReset();
  transportRef.current = null;
  mutation.mockReset();
  mutation.mockResolvedValue({ conversationId: "conv-1", turnId: "turn-1" });
  subscription.mockClear();
  navigateMock.mockClear();
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
  const opts = call[1] as { onData: (entry: unknown) => void };
  return opts.onData;
}

async function startTurn() {
  const rendered = renderPanel();
  await waitFor(() => expect(transportRef.current).not.toBeNull());
  await act(async () => {
    await transportRef.current!.sendMessages(sendOptions);
  });
  await waitFor(() => expect(subscription).toHaveBeenCalledTimes(1));
  return rendered;
}

describe("Feature: Langy opens the resource it surfaced in the browser", () => {
  describe("Rule: Langy navigates only when I asked to be taken somewhere", () => {
    describe("given I ask Langy to show me one of the scenario runs", () => {
      /** @scenario "Asking Langy to show a scenario run opens it in place" */
      it("lands the browser on that run's detail view via the SPA router", async () => {
        await startTurn();

        act(() => {
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
        });

        expect(navigateMock).toHaveBeenCalledWith("/demo/simulations/set_1/batch_1?openRun=run_1");
        // …and the move tore nothing down: the panel is still open with the
        // SAME live subscription — no remount, no re-subscribe.
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
      it("stays on the page I was on — no navigate entry, no push", async () => {
        await startTurn();

        act(() => {
          latestOnData()({ type: "delta", text: "Here are your runs." });
          latestOnData()({ type: "end" });
        });

        expect(navigateMock).not.toHaveBeenCalled();
      });
    });

    describe("given Langy could not look up the resource with my own access", () => {
      /** @scenario "Langy only navigates to resources reachable with my own access" */
      it("does not navigate, and the answer still renders", async () => {
        await startTurn();

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

        expect(navigateMock).not.toHaveBeenCalled();
        expect(useLangyStore.getState().isOpen).toBe(true);
      });
    });
  });

  describe("Rule: Agent navigation is SPA-safe and never tears the panel down", () => {
    describe("when Langy navigates me to a resource it surfaced", () => {
      /** @scenario "An agent-driven navigation keeps the panel and conversation mounted" */
      it("keeps the same live subscription mounted — the in-flight response keeps streaming", async () => {
        await startTurn();

        act(() => {
          latestOnData()({ type: "delta", text: "Here's the run: " });
          latestOnData()({
            type: "navigate",
            href: "/demo/simulations/set_1/batch_1?openRun=run_1",
          });
          latestOnData()({ type: "delta", text: "it passed." });
          latestOnData()({ type: "end" });
        });

        expect(navigateMock).toHaveBeenCalledTimes(1);
        expect(subscription).toHaveBeenCalledTimes(1);
      });
    });
  });
});
