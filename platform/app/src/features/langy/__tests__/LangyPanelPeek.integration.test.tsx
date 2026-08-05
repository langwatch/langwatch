/**
 * @vitest-environment jsdom
 *
 * Spec: specs/langy/langy-peek-dock.feature
 *
 * The minimised peek, asserted on the REAL panel — because the whole point of
 * this design is that there is no separate peek component to test. Minimising
 * moves THIS panel; the sliver you see is its own header. So the load-bearing
 * assertion here is node IDENTITY: the element that peeks and the element that
 * opens are the same DOM node, never a swap (a swap is what read as "popping
 * in and out").
 *
 * Boundary mocks are the established Langy panel harness (mirrors
 * LangyInlineModelSetup / LangyConversationThreading): project, useChat, the
 * `~/utils/api` surface, drawer, shaders. The two this suite drives itself are
 * the rollout flag (peek on/off) and a RESOLVED model, so the panel renders
 * its ordinary surface instead of the inline setup branch.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

// The rollout flag this suite exists to exercise: ON, minimising slides the
// panel down to its own sliver; OFF, closed means invisible and the classic
// launcher orb opens it. Mutable so both sides are covered.
const peekFlagRef = { current: true };
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: peekFlagRef.current, isLoading: false }),
}));

// The panel reads `currentDrawer` to decide whether it is riding beside a
// drawer as the floating companion. Defaults to no drawer (the dock/floating
// cases); the companion-header test flips it. The rest of the hook's surface is
// stubbed so any consumer that reaches for it gets a complete shape.
const currentDrawerRef = { current: undefined as string | undefined };
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    currentDrawer: currentDrawerRef.current,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
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
      langy: {
        list: { invalidate: () => Promise.resolve() },
      },
      langyGithub: {
        getInstallStatus: { invalidate: () => Promise.resolve() },
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
    langyGithub: {
      getInstallStatus: {
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
      onConversationUpdate: {
        useSubscription: () => undefined,
      },
      stopTurn: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      deleteConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      renameConversation: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
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
    // The empty state's asks are picked from the project's reach (see
    // useProjectReach); a fully-reached project keeps the classic four rows,
    // which is what the "normal empty state" assertions below look for.
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
import {
  FLOATING_PEEK_NEAR_PX,
  FLOATING_PEEK_REST_PX,
  resolvePeekTranslate,
} from "../logic/langyPeekDock";
import { useLangyStore } from "../stores/langyStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

const renderPanel = () => render(<LangySidecar />, { wrapper: Wrapper });

/** The panel itself — the one element that both peeks and opens. */
const panel = () =>
  screen.getByRole("complementary", { name: "Langy assistant" });
/**
 * The same node, straight from the DOM. Needed for the flag-off case, where
 * the panel is deliberately `aria-hidden` and so is (correctly) absent from
 * the accessibility tree that `getByRole` searches.
 */
const panelNode = () =>
  document.querySelector<HTMLElement>(
    '[role="complementary"][aria-label="Langy assistant"]',
  )!;
/** The peek's only control, a child of the panel. */
const openControl = () =>
  screen.queryByRole("button", { name: "Open Langy assistant" });
/** The flag-off launcher orb (also labelled "Open Langy assistant"). */
const orb = () => document.querySelector(".langy-orb-glow");

/** A pointer move the proximity listener can read (jsdom has no PointerEvent). */
const movePointer = (clientX: number, clientY: number) => {
  const event = new Event("pointermove");
  Object.assign(event, { clientX, clientY });
  act(() => {
    window.dispatchEvent(event);
  });
};

beforeEach(() => {
  projectRef.current = { id: "project-demo", slug: "demo" };
  // A resolved model keeps the panel on its ordinary surface (no inline setup).
  resolvedDefaultRef.current = {
    data: { model: "gpt-5-mini" },
    isLoading: false,
  };
  refetchResolvedDefault.mockClear();
  lastOnComplete.current = null;
  currentDrawerRef.current = undefined;
  peekFlagRef.current = true;
  window.localStorage.clear();
  useLangyStore.setState({ isOpen: false, panelMode: "floating" });
});

afterEach(() => cleanup());

describe("the minimised panel peeks as itself", () => {
  describe("given the peek rollout is on and the panel is minimised", () => {
    /** @scenario Minimising the floating panel sinks it to a bottom peek */
    it("slides the panel down to a sliver instead of hiding it", () => {
      renderPanel();
      expect(panel().getAttribute("data-langy-peek")).toBe("rest");
      expect(panel().style.translate).toBe(
        resolvePeekTranslate({ mode: "floating", phase: "rest" }),
      );
    });

    it("stays visible to assistive tech, unlike a hidden panel", () => {
      renderPanel();
      // aria-hidden would make the sliver — and its open control — unreachable.
      expect(panel().getAttribute("aria-hidden")).not.toBe("true");
      expect(openControl()).not.toBeNull();
    });

    it("makes its own body inert, so nothing behind the edge is tabbable", () => {
      renderPanel();
      // The composer and message log sit below the viewport edge while the
      // panel peeks. Off-screen is not unreachable — without `inert`, Tab
      // walks into a conversation nobody can see.
      const body = panel().querySelector<HTMLElement>("[data-langy-peek-body]");
      expect(body).not.toBeNull();
      expect(body!.inert).toBe(true);
    });

    it("hands the body back the moment it opens", async () => {
      renderPanel();
      await userEvent.click(openControl()!);
      const body = panel().querySelector<HTMLElement>("[data-langy-peek-body]");
      expect(body!.inert).toBe(false);
    });

    /** @scenario Clicking the peek opens the panel */
    it("opens on click — and it is the SAME element that was peeking", async () => {
      renderPanel();
      const before = panel();
      expect(before.getAttribute("data-langy-peek")).toBe("rest");

      await userEvent.click(openControl()!);

      const after = panel();
      // THE assertion this design exists for: one continuous element. If the
      // peek were a separate component swapping with the panel, these would be
      // different nodes and the motion would read as popping.
      expect(after).toBe(before);
      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(after.getAttribute("data-langy-peek")).toBeNull();
      // Open carries no peek residue.
      expect(after.style.translate).toBe("none");
    });

    /** @scenario The peek is a keyboard citizen */
    it("raises on keyboard focus and opens on Enter", async () => {
      renderPanel();
      openControl()!.focus();
      await waitFor(() =>
        expect(panel().getAttribute("data-langy-peek")).toBe("near"),
      );
      await userEvent.keyboard("{Enter}");
      expect(useLangyStore.getState().isOpen).toBe(true);
    });

    /** @scenario The peek rises as the pointer approaches */
    it("rises further on pointer proximity, on the same element", async () => {
      renderPanel();
      const node = panel();
      // jsdom viewport is 1024x768: just above the resting sliver.
      movePointer(800, 760);
      await waitFor(() =>
        expect(node.getAttribute("data-langy-peek")).toBe("near"),
      );
      expect(node.style.translate).toBe(
        resolvePeekTranslate({ mode: "floating", phase: "near" }),
      );
      // Still the same node — the rise is a translate, not a swap.
      expect(panel()).toBe(node);

      movePointer(60, 60);
      await waitFor(() =>
        expect(node.getAttribute("data-langy-peek")).toBe("rest"),
      );
    });

    it("rises further than it rests", () => {
      expect(FLOATING_PEEK_NEAR_PX).toBeGreaterThan(FLOATING_PEEK_REST_PX);
    });

    /** @scenario The peek shows the turn still running under it */
    it("marks itself working while a turn is still in flight", () => {
      renderPanel();
      expect(panel().hasAttribute("data-langy-peek-working")).toBe(false);
      act(() => {
        useLangyStore
          .getState()
          .beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
      });
      expect(panel().hasAttribute("data-langy-peek-working")).toBe(true);
    });
  });

  describe("given the panel is minimised in sidebar mode", () => {
    /** @scenario Minimising the docked panel leaves a sliver on the right edge */
    it("slides the dock right to a spine sliver", () => {
      act(() => {
        useLangyStore.setState({ panelMode: "sidebar" });
      });
      renderPanel();
      expect(panel().getAttribute("data-langy-peek-mode")).toBe("sidebar");
      expect(panel().style.translate).toBe(
        resolvePeekTranslate({ mode: "sidebar", phase: "rest" }),
      );
    });

    /** @scenario Minimising the docked panel leaves a sliver on the right edge */
    it("reserves no page room while it peeks", () => {
      act(() => {
        useLangyStore.setState({ panelMode: "sidebar" });
      });
      renderPanel();
      expect(useLangyStore.getState().dockShifted).toBe(false);
    });
  });

  describe("given the panel is open", () => {
    it("shows no peek control and no translate", () => {
      act(() => {
        useLangyStore.setState({ isOpen: true });
      });
      renderPanel();
      expect(panel().getAttribute("data-langy-peek")).toBeNull();
      expect(openControl()).toBeNull();
      expect(panel().style.translate).toBe("none");
    });

    /** @scenario Minimising the floating panel sinks it to a bottom peek */
    it("keeps the same node across minimise and reopen", () => {
      act(() => {
        useLangyStore.setState({ isOpen: true });
      });
      renderPanel();
      const opened = panel();

      act(() => {
        useLangyStore.getState().closePanel();
      });
      const peeked = panel();
      expect(peeked).toBe(opened);
      expect(peeked.getAttribute("data-langy-peek")).toBe("rest");

      act(() => {
        useLangyStore.getState().openPanel();
      });
      expect(panel()).toBe(opened);
    });
  });

  describe("given the peek rollout is off", () => {
    beforeEach(() => {
      peekFlagRef.current = false;
    });

    /** @scenario The rollout flag falls back to the launcher orb */
    it("keeps the panel hidden and offers the launcher orb instead", () => {
      renderPanel();
      expect(panelNode().getAttribute("data-langy-peek")).toBeNull();
      // Hidden means hidden — including from assistive tech, which is exactly
      // why this one is fetched from the DOM rather than by role.
      expect(panelNode().getAttribute("aria-hidden")).toBe("true");
      expect(panelNode().style.translate).toBe("none");
      // The orb is the flag-off opener — exactly one affordance, never both.
      expect(orb()).not.toBeNull();
    });
  });
});
