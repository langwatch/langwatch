/**
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-inline-model-setup.feature — the panel's
 * `langyNeedsModel` gate over `api.modelProvider.getResolvedDefault`.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@langwatch/workflow-web/surfaces/workflow-api", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

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

vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

// The credential form, at its module boundary: the panel's REAL branch
// (langyNeedsModel ? the inline setup : the empty state) and the real
// onComplete -> refetch wiring are what this file drives; the form itself is
// tested where it lives, and dragging its whole hook tree into jsdom would
// test the model-provider feature instead.
vi.mock("@langwatch/model-provider-web/surfaces/edit-model-provider-form", () => ({
  EditModelProviderForm: ({ onSaved }: { onSaved?: () => void }) => (
    <div data-testid="edit-model-provider-form">
      <label>
        Provider API Key
        <input aria-label="Provider API Key" />
      </label>
      <button type="button" onClick={() => onSaved?.()}>
        Save and continue
      </button>
    </div>
  ),
}));

/** Drives the gate query the inline model-setup branch reads. */
const resolvedDefaultRef: {
  current: { data: { model: string | null } | undefined; isLoading: boolean; isError: boolean };
} = { current: { data: undefined, isLoading: false, isError: false } };

/**
 * Saving writes the provider key and the project default; the next resolve
 * returns it. The spy mirrors that so the "save unblocks Langy" case can move
 * between the two states without remounting — which is the whole claim: no
 * page reload.
 */
const refetchResolvedDefault = vi.fn(() => {
  resolvedDefaultRef.current = { data: { model: "gpt-5-mini" }, isLoading: false, isError: false };
  return Promise.resolve({ data: resolvedDefaultRef.current.data });
});

vi.mock("../../../../../behavior/langy-api.ts", async () => {
  const { createTrpcUtils, idleQuery, withFallback } =
    await import("../../../__tests__/support/langy-api-mock.ts");

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
          refetch: refetchResolvedDefault,
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
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
  };

  return { api: withFallback(explicitApi), trpcClient: {} };
});

import { LangySidecar } from "../langy-panel.tsx";
import { LangyProvider } from "../../../../../ui/sections/langy-page-context.tsx";
import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import {
  LangyHostPort,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";

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
  refetchResolvedDefault.mockClear();
  useLangyStore.setState({ isOpen: true, panelMode: "floating" });
});

afterEach(() => {
  cleanup();
});

describe("given a project with no model provider configured", () => {
  describe("when the user opens the Langy panel", () => {
    /** @scenario "Langy shows an inline model setup when no model is configured" */
    it("shows the add-a-provider prompt with a key field instead of the empty state", async () => {
      resolvedDefaultRef.current = { data: { model: null }, isLoading: false, isError: false };

      renderPanel();

      expect(await screen.findByText("Langy needs a model to get started")).toBeInTheDocument();

      // A provider to choose and a key to paste, both in the panel.
      expect(
        screen.getByRole("button", { name: /Codex \(OpenAI account\), recommended/ }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Provider API Key")).toBeInTheDocument();

      // It replaces the ordinary empty state rather than sitting beside it.
      expect(screen.queryByText(/Just type away/)).not.toBeInTheDocument();
    });
  });
});

describe("given the Langy panel is showing the inline model setup", () => {
  describe("when the user saves a valid key and a default chat model", () => {
    /** @scenario "Saving a key and default model from Langy unblocks the assistant" */
    it("re-resolves the model in place and drops the setup prompt without a page reload", async () => {
      const user = userEvent.setup();
      resolvedDefaultRef.current = { data: { model: null }, isLoading: false, isError: false };

      const rendered = renderPanel();
      expect(await screen.findByText("Langy needs a model to get started")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Provider API Key"), "sk-test-key");
      await user.click(screen.getByRole("button", { name: "Save and continue" }));

      expect(refetchResolvedDefault).toHaveBeenCalledTimes(1);
      // The real refetch notifies subscribers; this mutable query double needs
      // an explicit rerender to model that update.
      rendered.rerender(<LangySidecar />);

      await waitFor(() => {
        expect(screen.queryByText("Langy needs a model to get started")).not.toBeInTheDocument();
      });
      expect(await screen.findByText(/Just type away/)).toBeInTheDocument();
    });
  });
});

describe("given a project that already has a default model configured", () => {
  describe("when the user opens the Langy panel", () => {
    /** @scenario "Langy skips the setup prompt when a model already resolves" */
    it("renders the normal empty state and no model setup prompt", async () => {
      resolvedDefaultRef.current = {
        data: { model: "gpt-5-mini" },
        isLoading: false,
        isError: false,
      };

      renderPanel();

      expect(await screen.findByText(/Just type away/)).toBeInTheDocument();
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
      expect(await screen.findByText(/Just type away/)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText("Langy needs a model to get started")).not.toBeInTheDocument();
      });
    });
  });
});
