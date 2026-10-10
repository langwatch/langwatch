/**
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-inline-model-setup.feature — the panel's
 * `langyNeedsModel` gate over `api.modelProvider.getResolvedDefault`.
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    stop: vi.fn(),
    status: "ready",
    setMessages: vi.fn(),
    error: undefined,
    clearError: vi.fn(),
    regenerate: vi.fn(),
  }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
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
vi.mock("../../../../../behavior/lent-edit-model-provider-form.tsx", () => ({
  LentEditModelProviderForm: ({
    onSaved,
    providerKey,
    embedded,
  }: {
    onSaved?: () => void;
    providerKey: string;
    embedded?: boolean;
  }) => (
    <div
      data-testid="edit-model-provider-form"
      data-provider={providerKey}
      data-embedded={String(Boolean(embedded))}
    >
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
 * Saving writes the provider key and the project default; the next
 * resolve returns it. The spy mirrors that so "save unblocks Langy" can
 * move between the two states without remounting - no page reload.
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
        useQuery: () => ({ data: [], isLoading: false }),
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

  return { api: withFallback(explicitApi) };
});

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import {
  LangyHostApi,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";
import { LangyProvider } from "../../../../tools/ui/sections/langy-page-context.tsx";
import { LangySidecar } from "../langy-panel.tsx";

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

class FakeLangyHost extends LangyHostApi {
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
  hasOrganizationPermission() {
    return false;
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
  <DesignSystemProvider forcedTheme="light">
    <LangyHostProvider value={new FakeLangyHost()}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
  </DesignSystemProvider>
);

function renderPanel() {
  return render(<LangySidecar />, { wrapper: Wrapper });
}

beforeEach(() => {
  resolvedDefaultRef.current = { data: undefined, isLoading: false, isError: false };
  refetchResolvedDefault.mockClear();
  sendMessage.mockClear();
  useLangyStore.setState({ isOpen: true, panelMode: "floating", pendingPrompt: null });
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
        screen.getByRole("button", { name: "Codex (OpenAI account), Recommended" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Provider API Key")).toBeInTheDocument();

      // It replaces the ordinary empty state rather than sitting beside it.
      expect(screen.queryByText(/Just type away/)).not.toBeInTheDocument();
    });
  });
});

describe("given the Langy panel is showing the inline model setup", () => {
  describe("when it first renders", () => {
    /** @scenario "The inline setup offers provider marks with Codex first and recommended" */
    it("shows the provider marks in order with Codex first, badged and selected", async () => {
      resolvedDefaultRef.current = { data: { model: null }, isLoading: false, isError: false };
      renderPanel();
      await screen.findByText("Langy needs a model to get started");

      expect(
        screen.getByText(
          "Langy uses this model to chat with you and help you work across the platform.",
        ),
      ).toBeInTheDocument();
      const cards = within(screen.getByRole("group", { name: "Model provider" })).getAllByRole(
        "button",
        { pressed: false },
      );
      const codex = screen.getByRole("button", { name: "Codex (OpenAI account), Recommended" });
      expect(codex).toHaveAttribute("aria-pressed", "true");
      expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
        "OpenAI",
        "Anthropic",
        "Google Gemini",
        "Azure OpenAI",
        "AWS Bedrock",
        "DeepSeek",
        "Groq",
        "Grok (xAI)",
        "Google Vertex AI",
        "Cerebras",
        "Custom, OpenAI-compatible",
      ]);
      const form = screen.getByTestId("edit-model-provider-form");
      expect(form).toHaveAttribute("data-provider", "openai_codex");
      expect(form).toHaveAttribute("data-embedded", "true");
    });
  });

  describe("when the user picks OpenAI", () => {
    /** @scenario "The inline setup offers provider marks with Codex first and recommended" */
    it("selects it and hands its key to the embedded form", async () => {
      resolvedDefaultRef.current = { data: { model: null }, isLoading: false, isError: false };
      renderPanel();
      await screen.findByText("Langy needs a model to get started");

      await userEvent.setup().click(screen.getByRole("button", { name: "OpenAI" }));

      expect(screen.getByRole("button", { name: "OpenAI" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("edit-model-provider-form")).toHaveAttribute(
        "data-provider",
        "openai",
      );
    });
  });
});

describe("given a project with no model and a question handed to Langy from a page", () => {
  describe("when the panel opens with that question queued", () => {
    /** @scenario "A question handed to Langy waits for a model instead of failing" */
    it("holds the question behind the setup prompt and sends it once a model resolves", async () => {
      resolvedDefaultRef.current = { data: { model: null }, isLoading: false, isError: false };
      const rendered = renderPanel();
      act(() => {
        useLangyStore.getState().askLangy("Set up my first evaluator");
      });

      expect(await screen.findByText("Langy needs a model to get started")).toBeInTheDocument();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(useLangyStore.getState().pendingPrompt).toBe("Set up my first evaluator");
      expect(screen.getByText("Set up my first evaluator")).toBeInTheDocument();
      expect(screen.getByText("Langy sends this once a model is set up.")).toBeInTheDocument();

      resolvedDefaultRef.current = {
        data: { model: "gpt-5-mini" },
        isLoading: false,
        isError: false,
      };
      rendered.rerender(<LangySidecar />);

      await waitFor(() => {
        expect(sendMessage).toHaveBeenCalledTimes(1);
      });
      expect(JSON.stringify(sendMessage.mock.calls[0]?.[0])).toContain("Set up my first evaluator");
      expect(useLangyStore.getState().pendingPrompt).toBeNull();
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
