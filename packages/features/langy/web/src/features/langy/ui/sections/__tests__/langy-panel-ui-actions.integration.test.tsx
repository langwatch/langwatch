/**
 * @vitest-environment jsdom
 *
 * Agent-driven page control, at the panel: a `ui` entry on the live turn
 * stream reaches the page's own handler through a claim, and the rollout flag
 * is what closes that channel. Boundary mocks mirror
 * langy-panel.docked-companion-header.integration.test.tsx (useChat captures
 * the real transport; `behavior/langy-api` is a hand-rolled double at the
 * network boundary) plus the host's `featureFlag`, which the test drives per
 * flag key.
 *
 * @see specs/langy/langy-ui-actions.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage } from "ai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LangyUiActionHandlers } from "../../../../model/ui-actions/langy-ui-action-types";

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
const claimUiAction = vi.fn(async (_input: unknown) => ({ isClaimed: true }));
const completeUiAction = vi.fn(async (_input: unknown) => ({
  isAccepted: true,
}));
const subscription = vi.fn((_input: unknown, _options: unknown) => ({
  unsubscribe: vi.fn(),
}));

vi.mock("../../../../../behavior/langy-api", async () => {
  const { createTrpcUtils, idleQuery, withFallback } = await import(
    "../../../__tests__/support/langy-api-mock"
  );

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
        claimUiAction: { mutate: (input: unknown) => claimUiAction(input) },
        completeUiAction: { mutate: (input: unknown) => completeUiAction(input) },
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

const PROJECT_ID = "project-demo";

// The panel reads two flags: the peek dock and the UI-action channel. This
// double answers per key so a test can close the channel and leave the rest of
// the panel as it was.
const flagsRef = {
  current: { release_langy_ui_actions: true } as Record<string, boolean>,
};

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
  featureFlag(flag: string) {
    return flagsRef.current[flag] ?? false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/demo/experiments" };
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

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyHostProvider value={host}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
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
  const opts = call[1] as { onData: (entry: unknown) => void };
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
