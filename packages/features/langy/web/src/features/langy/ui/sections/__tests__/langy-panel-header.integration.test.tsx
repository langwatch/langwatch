/**
 * The panel header rail: one line, the actions cluster, Minimise always last, and history as a PLACE that swaps the panel body for the recents list and hands it back.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-panel-header.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";

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

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "ready",
    setMessages: vi.fn(),
    error: undefined,
    clearError: vi.fn(),
    regenerate: vi.fn(),
  }),
}));

const currentDrawerRef = { current: undefined as string | undefined };
vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    currentDrawer: currentDrawerRef.current,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
}));

vi.mock("../../elements/langy-model-pill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

const ONE_CONVERSATION = {
  id: "conv-1",
  title: "Debugging the trace pipeline",
  isShared: false,
  isOwn: true,
  messageCount: 3,
  lastActivityAtMs: Date.now(),
};

vi.mock("../../../../../behavior/langy-api", async () => {
  const { createTrpcUtils, idleQuery, withFallback } =
    await import("../../../__tests__/support/langy-api-mock");

  const trpcUtils = createTrpcUtils();

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: { pages: [{ items: [ONE_CONVERSATION], nextCursor: null }] },
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

  return { api: withFallback(explicitApi), trpcClient: {} };
});

import { LangySidecar } from "../langy-panel";
import { LangyProvider } from "../langy-context";
import { useLangyStore } from "../../../../../index";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host";

class FakeLangyHost extends LangyHostPort {
  project() {
    return { id: PROJECT_ID, slug: "demo", name: "demo" };
  }
  organization() {
    return { id: "org-1" };
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

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyHostProvider value={new FakeLangyHost()}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
  </ChakraProvider>
);

function renderPanel() {
  return render(<LangySidecar />, { wrapper: Wrapper });
}

/** The actions cluster: every header control is a direct child of it — see PanelHeader. */
async function actionsCluster(): Promise<HTMLElement> {
  const newChat = await screen.findByRole("button", { name: "New chat" });
  return newChat.parentElement as HTMLElement;
}

beforeEach(() => {
  currentDrawerRef.current = undefined;
  useLangyStore.setState({ isOpen: true, panelMode: "floating" });
});

afterEach(() => {
  cleanup();
});

describe("given the Langy panel is open", () => {
  describe("when the header renders", () => {
    /** @scenario "The header is a single line" */
    it("shows one line, the title then the actions, with no subtitle underneath", async () => {
      renderPanel();

      // The actions cluster's own parent is the header row: exactly two
      // children (title, then actions). A subtitle row would add a third.
      const row = await actionsCluster();
      const headerRow = row.parentElement;
      expect(headerRow?.children.length).toBe(2);
      expect(headerRow?.children[1]).toBe(row);
    });

    /** @scenario "Minimise is the rightmost control" */
    it("puts the Minimise control last", async () => {
      renderPanel();

      const row = await actionsCluster();
      const buttons = within(row).getAllByRole("button");
      const last = buttons[buttons.length - 1];
      expect(last).toHaveAccessibleName("Minimise Langy");
    });

    /** @scenario "New conversation is distinct from minimise" */
    it("offers New chat apart from Minimise", async () => {
      renderPanel();

      const newChat = await screen.findByRole("button", { name: "New chat" });
      const minimise = await screen.findByRole("button", { name: "Minimise Langy" });

      expect(newChat).not.toBe(minimise);
      expect(newChat.compareDocumentPosition(minimise) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});

describe("given the Langy panel is open", () => {
  /** @scenario "History replaces the panel body with the recents list" */
  it("swaps the message column for the recents list and marks the control pressed", async () => {
    const user = userEvent.setup();
    renderPanel();

    const history = await screen.findByRole("button", { name: "Recent chats" });
    expect(history).toHaveAttribute("aria-pressed", "false");

    await user.click(history);

    expect(await screen.findByText("Recent chats")).toBeInTheDocument();
    expect(history).toHaveAttribute("aria-pressed", "true");
    // The composer is gone while browsing — this is a place, not a popover.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  describe("given the recents list is showing", () => {
    /** @scenario "Choosing a conversation hands the panel back" */
    it("returns to the message column on the chosen conversation", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(await screen.findByRole("button", { name: "Recent chats" }));
      const row = await screen.findByRole("button", {
        name: /Debugging the trace pipeline/,
      });
      await user.click(row);

      expect(screen.queryByText("Recent chats")).not.toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Recent chats" }),
      ).toHaveAttribute("aria-pressed", "false");
    });

    /** @scenario "Leaving the recents list without choosing" */
    it("returns to the message column on Back, Escape, or New chat, without picking anything", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(await screen.findByRole("button", { name: "Recent chats" }));
      await user.click(await screen.findByRole("button", { name: "Back to chat" }));

      expect(screen.queryByText("Recent chats")).not.toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Recent chats" }),
      ).toHaveAttribute("aria-pressed", "false");
    });
  });
});
