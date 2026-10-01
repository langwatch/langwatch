/**
 * @vitest-environment jsdom
 * @see specs/home/guided-onboarding-offer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();
const beginPathMutate = vi.fn();
const recordTourMutate = vi.fn();
const dock = vi.fn();
const queueKickoff = vi.fn();
const failed = vi.fn();

vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: unknown }) => children,
  useAnalytics: () => ({ emit: emitMock }),
}));

vi.mock("../../../../../behavior/onboarding-api.ts", () => ({
  onboardingApi: {
    useUtils: () => ({ onboarding: { getGuidedState: { invalidate: vi.fn() } } }),
    onboarding: {
      beginPath: { useMutation: () => ({ mutateAsync: beginPathMutate }) },
      recordTour: { useMutation: () => ({ mutate: recordTourMutate }) },
      attachConversation: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

let guided: {
  enabled: boolean;
  state: Record<string, unknown> | null;
};
vi.mock("../../../behavior/use-guided-onboarding.ts", () => ({
  useGuidedOnboardingFlag: () => ({ enabled: guided.enabled, organizationId: "org_1" }),
  useGuidedOnboarding: () => ({ state: guided.state }),
}));

vi.mock("../../../../../model/onboarding-host.ts", () => ({
  useOnboardingHost: () => ({
    scope: () => ({ organization: { id: "org_1", name: "Acme" } }),
    currentUser: () => ({ id: "u1", name: "Ada Lovelace" }),
    failed,
    langy: () => ({
      dock,
      queueKickoff,
      onScopeAnnounced: (_id: string, callback: () => void) => {
        callback();
        return () => undefined;
      },
    }),
  }),
}));

import { useGuidedTourStore } from "../../../behavior/guided-tour-store.ts";
import GuidedOnboardingOffer from "../guided-onboarding-offer.tsx";

const guidedState = (over: Record<string, unknown> = {}) => ({
  variant: "guided",
  paths: ["llmops", "gateway"],
  currentPath: null,
  donePaths: [],
  conversationId: null,
  ...over,
});

function renderOffer(props: {
  space: "project" | "me" | "gateway" | "governance";
  spaceInUse?: boolean | null;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <GuidedOnboardingOffer {...props} />
    </ChakraProvider>,
  );
}

const pill = () => screen.queryByTestId("guided-onboarding-offer");

describe("GuidedOnboardingOffer", () => {
  beforeEach(() => {
    guided = { enabled: true, state: guidedState() };
    beginPathMutate.mockResolvedValue(guidedState({ currentPath: "gateway" }));
    useGuidedTourStore.setState({ running: false });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given a space that reads as empty", () => {
    /** @scenario the offer shows on the gateway, governance and personal homes */
    it("shows the pill in every space", () => {
      for (const space of ["project", "gateway", "governance", "me"] as const) {
        const { unmount } = renderOffer({ space, spaceInUse: false });
        expect(pill()).toHaveTextContent("Start guided onboarding");
        unmount();
      }
    });

    /** @scenario the offer is hidden while Langy is guiding that same space */
    it("hides while Langy guides that space", () => {
      guided.state = guidedState({ currentPath: "llmops" });
      renderOffer({ space: "project", spaceInUse: false });
      expect(pill()).toBeNull();
    });

    /** @scenario the offer is hidden once the space is done */
    it("hides once the space is done", () => {
      guided.state = guidedState({ donePaths: ["gateway"] });
      renderOffer({ space: "gateway", spaceInUse: false });
      expect(pill()).toBeNull();
    });

    /** @scenario the offer is hidden while a tour is on screen */
    it("hides while a tour runs", () => {
      useGuidedTourStore.setState({ running: true });
      renderOffer({ space: "gateway", spaceInUse: false });
      expect(pill()).toBeNull();
    });

    /** @scenario a path picked on the value screen but not started yet is offered in its space */
    it("offers a picked path that has not started", () => {
      guided.state = guidedState({ paths: ["llmops", "gateway"], currentPath: "llmops" });
      renderOffer({ space: "gateway", spaceInUse: false });
      expect(pill()).not.toBeNull();
    });

    /** @scenario the classic variant never shows the offer */
    it("never shows for the classic variant", () => {
      guided.state = guidedState({ variant: "classic" });
      renderOffer({ space: "project", spaceInUse: false });
      expect(pill()).toBeNull();
    });
  });

  describe("given the space is in use or not yet known", () => {
    /** @scenario the offer waits until it knows whether the space is in use */
    it("stays hidden while unknown", () => {
      renderOffer({ space: "gateway", spaceInUse: null });
      expect(pill()).toBeNull();
    });

    /** @scenario a gateway with virtual keys is not offered the guided onboarding */
    it("stays hidden once the space is in use", () => {
      renderOffer({ space: "gateway", spaceInUse: true });
      expect(pill()).toBeNull();
    });
  });

  describe("when the pill is clicked", () => {
    /** @scenario clicking the offer begins the path and runs its tour */
    it("begins the path, docks Langy and starts the tour", async () => {
      renderOffer({ space: "gateway", spaceInUse: false });
      fireEvent.click(pill() as HTMLElement);
      await waitFor(() => expect(useGuidedTourStore.getState().running).toBe(true));
      expect(beginPathMutate).toHaveBeenCalledWith({ organizationId: "org_1", path: "gateway" });
      expect(dock).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith("clicked", "home_offer", { path: "gateway" });
    });

    /** @scenario the coding offer queues the kickoff with no tour */
    it("queues the coding kickoff straight away", async () => {
      beginPathMutate.mockResolvedValue(guidedState({ currentPath: "coding" }));
      renderOffer({ space: "me", spaceInUse: false });
      fireEvent.click(pill() as HTMLElement);
      await waitFor(() => expect(queueKickoff).toHaveBeenCalledTimes(1));
      expect(useGuidedTourStore.getState().running).toBe(false);
    });

    /** @scenario a failed begin keeps the offer and shows the error */
    it("keeps the pill and reports the failure", async () => {
      const error = new Error("refused");
      beginPathMutate.mockRejectedValue(error);
      renderOffer({ space: "gateway", spaceInUse: false });
      fireEvent.click(pill() as HTMLElement);
      await waitFor(() => expect(failed).toHaveBeenCalledWith(expect.objectContaining({ error })));
      expect(pill()).not.toBeNull();
    });
  });
});
