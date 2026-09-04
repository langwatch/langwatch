/**
 * @vitest-environment jsdom
 *
 * Spec: specs/langy/langy-inline-model-setup.feature — the panel's
 * `langyNeedsModel` gate over `api.modelProvider.getResolvedDefault`.
 *
 * Boundary mocks mirror `langy-panel.docked-companion-header.integration.test.tsx`:
 * the Langy host, `@ai-sdk/react` and the Langy API surface (the shared
 * in-memory tRPC-shaped double). The panel itself is real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    currentDrawer: undefined,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
}));

vi.mock("../../elements/langy-model-pill", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

/** Drives the gate query the inline model-setup branch reads. */
const resolvedDefaultRef: {
  current: { data: { model: string | null } | undefined; isLoading: boolean; isError: boolean };
} = { current: { data: undefined, isLoading: false, isError: false } };

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
        useQuery: () => ({ data: { modelsAllowed: null }, isLoading: false, isError: false }),
      },
      messages: {
        useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
      },
      stopTurn: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: resolvedDefaultRef.current.data,
          isLoading: resolvedDefaultRef.current.isLoading,
          // Mirrors react-query's own relationship between the three fields:
          // an errored query also reports isLoading false with data
          // undefined, so the panel gates on isSuccess rather than !isLoading.
          isSuccess: !resolvedDefaultRef.current.isLoading && !resolvedDefaultRef.current.isError,
          isError: resolvedDefaultRef.current.isError,
          refetch: () => Promise.resolve(),
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: { providers: [] }, isLoading: false }),
      },
      setRoleAssignmentForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      setFeatureOverrideForScope: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
    },
    virtualKeys: { list: { useQuery: () => ({ data: undefined, isLoading: false }) } },
    github: {
      getConnectionStatus: { useQuery: () => ({ data: undefined, isLoading: false, isError: true }) },
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
  resolvedDefaultRef.current = { data: undefined, isLoading: false, isError: false };
  useLangyStore.setState({ isOpen: true, panelMode: "floating" });
});

afterEach(() => {
  cleanup();
});

describe("given a project that already has a default model configured", () => {
  describe("when the user opens the Langy panel", () => {
    /** @scenario "Langy skips the setup prompt when a model already resolves" */
    it("renders the normal empty state and no model setup prompt", async () => {
      resolvedDefaultRef.current = { data: { model: "gpt-5-mini" }, isLoading: false, isError: false };

      renderPanel();

      expect(
        await screen.findByText(/Just type away/),
      ).toBeInTheDocument();
      expect(screen.queryByText("Langy needs a model to get started")).not.toBeInTheDocument();
    });
  });
});

describe("given the project's model resolver fails to answer", () => {
  describe("when the user opens the Langy panel", () => {
    /** @scenario "A failed model lookup does not masquerade as a missing model" */
    it("does not show the setup prompt for what is really a failed lookup", async () => {
      resolvedDefaultRef.current = { data: undefined, isLoading: false, isError: true };

      renderPanel();

      // A positive anchor first: the ordinary empty state is what a failed
      // lookup must fall back to, not merely "the setup prompt is absent",
      // which would also hold for a panel that rendered nothing at all.
      expect(
        await screen.findByText(/Just type away/),
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText("Langy needs a model to get started")).not.toBeInTheDocument();
      });
    });
  });
});
