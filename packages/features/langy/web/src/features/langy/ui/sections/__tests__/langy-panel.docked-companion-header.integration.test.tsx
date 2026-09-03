/**
 * @vitest-environment jsdom
 *
 * The dock's room is reserved by exactly one party.
 *
 * Spec: specs/langy/langy-panel-layout.feature
 *
 * Boundary mocks: the project/host context, `@ai-sdk/react`, the model picker
 * (an unrelated dependency chain), and the Langy API surface (an in-memory
 * tRPC-shaped double). The panel, the store and the header are all real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";

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

/** The wrapper releases the dock reservation while a drawer is open — see
 * `ProjectLangyLayout`. Here the panel reads `currentDrawer` directly to know
 * it is riding beside one as a floating companion. */
const currentDrawerRef = { current: undefined as string | undefined };
vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    currentDrawer: currentDrawerRef.current,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
}));

// Cuts the model picker's dependency chain onto the (unrelated) workflow
// studio host — this test is about the header's controls, not the picker.
vi.mock("../../elements/langy-model-pill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
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
      // A resolved model — the scenario is about the header, not the inline
      // model-setup branch, so the panel must not fall into it.
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

beforeEach(() => {
  currentDrawerRef.current = undefined;
  useLangyStore.setState({ isOpen: true, panelMode: "floating" });
});

afterEach(() => {
  cleanup();
});

describe("given the Langy panel is docked or floating on its own", () => {
  describe("when the header renders", () => {
    it("offers its own Minimise control", async () => {
      renderPanel();

      expect(await screen.findByRole("button", { name: "Minimise Langy" })).toBeInTheDocument();
    });
  });
});

describe("given the Langy panel is riding beside an open drawer", () => {
  describe("when the header renders", () => {
    /** @scenario The docked companion offers a single close affordance */
    it("hides its own Minimise so the drawer owns the only dismissal", async () => {
      // Only the DOCKED (sidebar) panel becomes the drawer's companion — the
      // floating panel dodges sideways instead. See the note above
      // `isDrawerCompanion` in the panel.
      useLangyStore.setState({ panelMode: "sidebar" });
      currentDrawerRef.current = "traceV2Details";
      renderPanel();

      // The panel is up (its new-chat control is present)...
      expect(await screen.findByRole("button", { name: "New chat" })).toBeInTheDocument();
      // ...but the companion header carries no Minimise: a second dismissal
      // beside the drawer's own X read as "close the drawer" and kept
      // dismissing Langy instead.
      expect(screen.queryByRole("button", { name: "Minimise Langy" })).not.toBeInTheDocument();
    });
  });
});
