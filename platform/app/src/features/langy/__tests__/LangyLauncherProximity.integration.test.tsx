/**
 * @vitest-environment jsdom
 *
 * Spec: specs/langy/langy-peek-dock.feature (the flag-off launcher orb)
 *
 * The launcher orb's proximity glow, asserted on the REAL sidecar — because the
 * defect this pins is not in the hook, it is in the WIRING.
 *
 * `LangyLauncher` stays MOUNTED for the whole session and merely renders null
 * while the panel is open, so the orb NODE comes and goes underneath a
 * component that never unmounts. `useLangyOrbProximity`'s effect keys on
 * `[enabled]` alone, so unless `enabled` also falls while the panel is open the
 * effect never re-runs: the window listeners stay bound to the first orb, the
 * rAF keeps writing styles into a detached element (retaining it), and the
 * reopened orb is dead for the rest of the session.
 *
 * `hooks/__tests__/useLangyOrbProximity.unit.test.ts` pins the hook's half of
 * that contract (disabling lets go, re-enabling rebinds). This file pins the
 * half that lives in the panel: that the launcher actually FEEDS the hook
 * `isOpen`, by driving a real open/close cycle and asking the orb you get back
 * whether it still reacts to the pointer.
 *
 * Boundary mocks only: project, useChat, drawer, shaders, and the `~/utils/api`
 * surface — which comes from the shared `support/langyApiMock` harness rather
 * than another hand-written copy of the panel's whole tRPC surface, so a query
 * the panel adds tomorrow is answered here without this file being touched. The
 * one this suite fixes rather than drives is the peek rollout flag — OFF, which
 * is what puts the launcher orb on screen at all.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (hoisted — must precede the LangySidecar import)
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

// Flag OFF is the whole premise: the corner launcher orb is the minimised
// affordance, and it is the orb's proximity wiring under test.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

// No drawer, so the launcher stays in its bottom-right home and never dodges.
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    currentDrawer: undefined,
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
      /* no turn is sent here */
    }
  },
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock(
  "~/features/onboarding/components/sections/ModelProviderScreen",
  () => ({
    ModelProviderScreen: () => <div data-testid="model-provider-screen" />,
  }),
);

// The whole tRPC surface the panel touches comes from the shared harness, which
// answers anything a suite has not spoken for with a settled-idle query, a no-op
// mutation or a no-op subscription. This suite is about a button's pointer
// wiring, so it speaks for exactly one procedure and lets the rest stay inert.
//
// Imported INSIDE the factory: `vi.mock` is hoisted above the imports, so a
// top-level binding is still in its temporal dead zone when this runs.
vi.mock("~/utils/api", async () => {
  const { createTrpcUtils, idleQuery, withFallback } = await import(
    "./support/langyApiMock"
  );
  const trpcUtils = createTrpcUtils();

  return {
    api: withFallback({
      useUtils: () => trpcUtils,
      useContext: () => trpcUtils,
      modelProvider: withFallback({
        // The one override. Without a resolved model the panel renders the
        // inline model-setup branch instead of its ordinary surface, and the
        // open/close cycle this suite drives never happens.
        getResolvedDefault: {
          useQuery: () => ({
            ...idleQuery(),
            data: { model: "gpt-5-mini" },
            isSuccess: true,
            refetch: () => Promise.resolve({ data: { model: "gpt-5-mini" } }),
          }),
        },
      }),
    }),
  };
});

import { LangySidecar } from "../components/LangyPanel";
import { LangyProvider } from "../LangyContext";
import { useLangyStore } from "../stores/langyStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

const renderSidecar = () => render(<LangySidecar />, { wrapper: Wrapper });

/**
 * The launcher orb button, found through the glow layer only it owns — the
 * peeking panel's open control carries the same accessible name, so the name
 * alone would not tell them apart if the flag ever flipped.
 */
const orbButton = () =>
  document
    .querySelector<HTMLSpanElement>(".langy-orb-glow")
    ?.closest("button") ?? null;

const orbGlow = () =>
  document.querySelector<HTMLSpanElement>(".langy-orb-glow");

/** A pointer move the proximity listener can read (jsdom has no PointerEvent). */
const movePointerOntoTheOrb = () => {
  const event = new Event("pointermove");
  // jsdom gives every element a zero rect, so the orb's centre is the origin;
  // a few px from it is well inside the proximity radius.
  Object.assign(event, { clientX: 6, clientY: 6 });
  act(() => {
    window.dispatchEvent(event);
  });
};

/** The orb reacts imperatively — the rAF writes a transform, no re-render. */
const waitForTheOrbToLean = (node: HTMLElement) =>
  waitFor(() => expect(node.style.transform).not.toBe(""));

/** Long enough for the proximity rAF to run several frames, if anything owns it. */
const letSeveralFramesRun = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

beforeEach(() => {
  projectRef.current = { id: "project-demo", slug: "demo" };
  window.localStorage.clear();
  useLangyStore.setState({ isOpen: false, panelMode: "floating" });
});

afterEach(() => cleanup());

describe("the launcher orb's proximity glow", () => {
  describe("given the panel has never been opened", () => {
    it("leans the orb toward an approaching pointer", async () => {
      renderSidecar();
      const orb = orbButton();
      expect(orb).not.toBeNull();

      movePointerOntoTheOrb();

      await waitForTheOrbToLean(orb!);
      await waitFor(() =>
        expect(Number(orbGlow()!.style.opacity)).toBeGreaterThan(0),
      );
    });
  });

  describe("when the panel has been opened and closed again", () => {
    it("still leans toward the pointer, on the orb that is on screen now", async () => {
      renderSidecar();
      const first = orbButton()!;
      movePointerOntoTheOrb();
      await waitForTheOrbToLean(first);

      await userEvent.click(first);
      expect(useLangyStore.getState().isOpen).toBe(true);
      // The launcher renders null while the panel is open; its orb is gone.
      expect(orbButton()).toBeNull();
      act(() => {
        useLangyStore.getState().closePanel();
      });

      // A NEW button, which is exactly the problem: nothing re-runs the hook's
      // effect for it unless `enabled` fell while the panel was open.
      const second = orbButton()!;
      expect(second).not.toBe(first);

      movePointerOntoTheOrb();

      await waitForTheOrbToLean(second);
      await waitFor(() =>
        expect(Number(orbGlow()!.style.opacity)).toBeGreaterThan(0),
      );
    });

    it("stops driving the orb it left behind, so the detached node is released", async () => {
      renderSidecar();
      const first = orbButton()!;
      movePointerOntoTheOrb();
      await waitForTheOrbToLean(first);

      await userEvent.click(first);
      act(() => {
        useLangyStore.getState().closePanel();
      });
      movePointerOntoTheOrb();
      await letSeveralFramesRun();

      // The first orb is off the document now, and a rAF still writing styles
      // into it is precisely what keeps it alive — the retention half of the
      // same defect, and the reason the glow never comes back.
      expect(first.isConnected).toBe(false);
      expect(first.style.transform).toBe("");
    });
  });
});
