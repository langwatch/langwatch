/**
 * @vitest-environment jsdom
 *
 * Spec: langwatch/specs/assistant/langy-inline-model-setup.feature — "Langy
 * prompts for a model when the project has none configured".
 *
 * Component integration test of the Langy panel's inline model-setup branch.
 * The panel computes `langyNeedsModel` from the project's resolved default
 * model (`api.modelProvider.getResolvedDefault`): when nothing resolves it
 * renders an inline ModelProviderScreen ("langy" variant) instead of the
 * empty state, and saving (the screen's `onComplete`) refetches the resolver
 * so the panel flips to usable in place — no page reload.
 *
 * Boundary mocks mirror LangyConversationThreading.integration.test.tsx
 * (useOrganizationTeamProject, @ai-sdk/react useChat, ai DefaultChatTransport,
 * the `~/utils/api` surface the panel reads). The one driver this test owns
 * is `getResolvedDefault`: a mutable ref + a refetch spy lets it move through
 * the three spec states. ModelProviderScreen is mocked at its module seam so
 * the test exercises the panel's REAL branching + onComplete→refetch wiring
 * without dragging the entire onboarding form/hook tree into jsdom — the
 * screen itself is tested where it lives.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (hoisted — must precede the LangyDrawer import)
// ---------------------------------------------------------------------------

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

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "ready",
    setMessages: vi.fn(),
  }),
}));

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(_opts: unknown) {
      /* the transport is irrelevant to the model-setup branch */
    }
  },
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

// The inline setup screen. Mocked at its module boundary so the panel's REAL
// branch (langyNeedsModel ? <ModelProviderScreen … onComplete> : …) is what's
// under test, while the heavy onboarding form/hook tree isn't pulled into
// jsdom. The mock exposes the variant (proves the panel chose "langy") and a
// button that fires `onComplete` (proves the save→unblock wiring).
const lastOnComplete = { current: null as null | (() => void) };
vi.mock(
  "~/features/onboarding/components/sections/ModelProviderScreen",
  () => ({
    ModelProviderScreen: ({
      variant,
      onComplete,
    }: {
      variant: string;
      onComplete?: () => void;
    }) => {
      lastOnComplete.current = onComplete ?? null;
      return (
        <div data-testid="model-provider-screen" data-variant={variant}>
          <label>
            Provider API Key
            <input aria-label="Provider API Key" />
          </label>
          <button type="button" onClick={() => onComplete?.()}>
            Save and continue
          </button>
        </div>
      );
    },
  }),
);

// Drives langyNeedsModel. `model: null` (or absent) => setup; a string => the
// panel resolves a model and skips the prompt. A refetch spy lets the "save
// unblocks" test flip the state without remounting (no page reload).
const resolvedDefaultRef = {
  current: {
    data: undefined as { model: string | null } | undefined,
    isLoading: false,
  },
};
const refetchResolvedDefault = vi.fn(() => {
  // Saving wires the project default; the next resolve returns it. Mirror the
  // real refetch by flipping the query data to a resolved model.
  resolvedDefaultRef.current = {
    data: { model: "gpt-5-mini" },
    isLoading: false,
  };
  return Promise.resolve({ data: resolvedDefaultRef.current.data });
});

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      langyGithub: {
        getConnection: { invalidate: () => Promise.resolve() },
      },
    }),
    langyGithub: {
      getConnection: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
    },
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: resolvedDefaultRef.current.data,
          isLoading: resolvedDefaultRef.current.isLoading,
          refetch: refetchResolvedDefault,
        }),
      },
      // The Composer's ModelSelector lists the project's providers; the
      // model-setup branch doesn't depend on it, so an empty list is fine.
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: { providers: [] }, isLoading: false }),
      },
    },
    virtualKeys: {
      list: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

import { LangyDrawer } from "../LangySidebar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderPanel() {
  return render(<LangyDrawer isOpen={true} onOpenChange={() => undefined} />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  projectRef.current = { id: "project-demo", slug: "demo" };
  resolvedDefaultRef.current = { data: undefined, isLoading: false };
  refetchResolvedDefault.mockClear();
  lastOnComplete.current = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Feature: Langy prompts for a model when the project has none configured", () => {
  describe("given a project with no model provider configured", () => {
    describe("when the user opens the Langy panel", () => {
      /** @scenario "Langy shows an inline model setup when no model is configured" */
      it("shows the add-a-provider prompt with a key field instead of the empty state", async () => {
        // No model resolves for the gate key.
        resolvedDefaultRef.current = {
          data: { model: null },
          isLoading: false,
        };

        renderPanel();

        // The panel shows a prompt to add a model provider.
        expect(
          await screen.findByText("Langy needs a model to get started"),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Add a provider key and pick a default model/i),
        ).toBeInTheDocument();

        // The user can choose a provider and enter an API key without leaving
        // Langy — the inline ModelProviderScreen (langy variant) is rendered
        // with an API key field, in place.
        const setup = screen.getByTestId("model-provider-screen");
        expect(setup).toHaveAttribute("data-variant", "langy");
        expect(screen.getByLabelText("Provider API Key")).toBeInTheDocument();

        // It replaces — not supplements — the normal empty state.
        expect(screen.queryByText("How can I help?")).not.toBeInTheDocument();
      });
    });
  });

  describe("given the Langy panel is showing the inline model setup", () => {
    describe("when the user saves a valid key and a default chat model", () => {
      /** @scenario "Saving a key and default model from Langy unblocks the assistant" */
      it("refetches the resolver and drops the setup prompt without a page reload", async () => {
        const user = userEvent.setup();
        // Start blocked: no model resolves.
        resolvedDefaultRef.current = {
          data: { model: null },
          isLoading: false,
        };

        renderPanel();
        expect(
          await screen.findByText("Langy needs a model to get started"),
        ).toBeInTheDocument();

        // Saving fires the screen's onComplete, which the panel wired to
        // refetch the gate model (the save itself wrote the provider key +
        // project default — mocked at the screen boundary).
        await user.type(
          screen.getByLabelText("Provider API Key"),
          "sk-test-key",
        );
        await user.click(
          screen.getByRole("button", { name: "Save and continue" }),
        );

        // The panel re-resolved the model in place (no navigation / reload):
        // the refetch ran...
        expect(refetchResolvedDefault).toHaveBeenCalledTimes(1);

        // ...and Langy stops showing the setup prompt and becomes usable
        // (the resolver now returns a model, so the empty state renders).
        await waitFor(() => {
          expect(
            screen.queryByText("Langy needs a model to get started"),
          ).not.toBeInTheDocument();
        });
        expect(await screen.findByText("How can I help?")).toBeInTheDocument();
      });
    });
  });

  describe("given a project that already has a default model configured", () => {
    describe("when the user opens the Langy panel", () => {
      /** @scenario "Langy skips the setup prompt when a model already resolves" */
      it("renders the normal empty state and no model setup prompt", async () => {
        // A model resolves for the gate key.
        resolvedDefaultRef.current = {
          data: { model: "gpt-5-mini" },
          isLoading: false,
        };

        renderPanel();

        // The panel shows its normal empty state.
        expect(await screen.findByText("How can I help?")).toBeInTheDocument();

        // No model setup prompt is shown.
        expect(
          screen.queryByText("Langy needs a model to get started"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("model-provider-screen"),
        ).not.toBeInTheDocument();
      });
    });
  });
});
