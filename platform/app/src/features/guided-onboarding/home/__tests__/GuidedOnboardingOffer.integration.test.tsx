/**
 * @vitest-environment jsdom
 *
 * The visibility matrix of the "Start guided onboarding" pill and what a
 * click does: begin the path, open the panel docked, run the tour when the
 * path has one, queue the kickoff continuing the attached conversation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import type { GuidedSpace } from "../../landing";

const emitMock = vi.fn();
vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: React.ReactNode }) => children,
  useAnalytics: () => ({ emit: emitMock }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/utils/compat/next-navigation", () => ({
  usePathname: () => "/acme-checkout",
}));

let flagEnabled = true;
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: flagEnabled, isLoading: false }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_1", name: "ACME" },
    project: { id: "proj_1", slug: "acme-checkout" },
  }),
}));
vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user_1", name: "Riley Stone" } },
  }),
}));
let isNewProject = true;
vi.mock("~/components/home/useProjectReach", () => ({
  useProjectReach: () => ({ isNewProject }),
}));

let guidedState: GuidedOnboardingState = { paths: [], donePaths: [] };
const beginPathMutateAsync = vi.fn();
const recordTourMutate = vi.fn();
const invalidate = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ onboarding: { getGuidedState: { invalidate } } }),
    onboarding: {
      getGuidedState: {
        useQuery: () => ({ data: guidedState, isLoading: false }),
      },
      beginPath: { useMutation: () => ({ mutateAsync: beginPathMutateAsync }) },
      recordTour: { useMutation: () => ({ mutate: recordTourMutate }) },
    },
  },
}));

const showErrorToast = vi.fn();
vi.mock("~/features/errors/logic/showErrorToast", () => ({
  showErrorToast: (args: unknown) => showErrorToast(args),
}));

const queueGuidedKickoff = vi.fn();
const openPanel = vi.fn();
const setPanelMode = vi.fn();
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: {
    getState: () => ({ queueGuidedKickoff, openPanel, setPanelMode }),
  },
}));

import { useGuidedTourStore } from "../../tour/guidedTourStore";
import { GuidedOnboardingOffer } from "../GuidedOnboardingOffer";

function renderOffer(space: GuidedSpace) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <GuidedOnboardingOffer space={space} />
    </ChakraProvider>,
  );
}
const pill = () => screen.queryByTestId("guided-onboarding-offer");

describe("GuidedOnboardingOffer", () => {
  beforeEach(() => {
    flagEnabled = true;
    isNewProject = true;
    guidedState = { paths: [], donePaths: [] };
    beginPathMutateAsync.mockReset();
    recordTourMutate.mockReset();
    queueGuidedKickoff.mockReset();
    openPanel.mockReset();
    setPanelMode.mockReset();
    showErrorToast.mockReset();
    emitMock.mockReset();
    useGuidedTourStore.setState({
      running: false,
      path: null,
      stepIndex: 0,
      handoff: null,
      runId: 0,
      onEnd: null,
    });
  });
  afterEach(cleanup);

  describe("given a day-zero project in the guided variant", () => {
    /** @scenario the offer shows on the project home under the search bar */
    it("shows the pill on the project home", () => {
      renderOffer("project");
      expect(pill()).toHaveTextContent("Start guided onboarding");
    });

    /** @scenario the offer shows on the gateway, governance and personal homes */
    it("shows the pill on the gateway, governance and personal homes", () => {
      for (const space of ["gateway", "governance", "me"] as const) {
        renderOffer(space);
        expect(pill()).toBeInTheDocument();
        cleanup();
      }
    });

    /** @scenario the offer is hidden while Langy is guiding that same space */
    it("hides while the space's path is the current one", () => {
      guidedState = { paths: ["llmops"], currentPath: "llmops", donePaths: [] };
      renderOffer("project");
      expect(pill()).toBeNull();
    });

    /** @scenario the offer is hidden once the space is done */
    it("hides once the space's path is done", () => {
      guidedState = { paths: ["gateway"], donePaths: ["gateway"] };
      renderOffer("gateway");
      expect(pill()).toBeNull();
    });

    /** @scenario the offer is hidden while a tour is on screen */
    it("hides while a tour runs", () => {
      useGuidedTourStore.setState({ running: true, path: "gateway" });
      renderOffer("gateway");
      expect(pill()).toBeNull();
    });

    /** @scenario a path picked on the value screen but not started yet is offered in its space */
    it("offers a picked path that has not started", () => {
      guidedState = {
        paths: ["llmops", "gateway"],
        currentPath: "llmops",
        donePaths: [],
      };
      renderOffer("gateway");
      expect(pill()).toBeInTheDocument();
    });

    /** @scenario a space the user never picked is offered too */
    it("offers a space that was never picked", () => {
      guidedState = { paths: ["llmops"], currentPath: "llmops", donePaths: [] };
      renderOffer("governance");
      expect(pill()).toBeInTheDocument();
    });
  });

  describe("given a project with traces", () => {
    /** @scenario the offer is hidden on a project that already has traces */
    it("shows no pill", () => {
      isNewProject = false;
      renderOffer("project");
      expect(pill()).toBeNull();
    });
  });

  describe("given the classic variant", () => {
    /** @scenario the classic variant never shows the offer */
    it("shows no pill", () => {
      flagEnabled = false;
      renderOffer("project");
      expect(pill()).toBeNull();
    });
  });

  describe("when the gateway pill is clicked", () => {
    /** @scenario clicking the offer begins the path and runs its tour */
    it("begins the path, opens the panel docked and starts the gateway tour", async () => {
      beginPathMutateAsync.mockResolvedValue({
        paths: ["gateway"],
        currentPath: "gateway",
        donePaths: [],
      });
      renderOffer("gateway");
      fireEvent.click(pill()!);
      await waitFor(() =>
        expect(beginPathMutateAsync).toHaveBeenCalledWith({
          organizationId: "org_1",
          path: "gateway",
        }),
      );
      await waitFor(() =>
        expect(useGuidedTourStore.getState().running).toBe(true),
      );
      expect(useGuidedTourStore.getState().path).toBe("gateway");
      expect(openPanel).toHaveBeenCalled();
      expect(setPanelMode).toHaveBeenCalledWith("sidebar");
      expect(emitMock).toHaveBeenCalledWith("clicked", "home_offer", {
        path: "gateway",
      });
      expect(queueGuidedKickoff).not.toHaveBeenCalled();
    });

    /** @scenario the kickoff continues the attached conversation when the tour ends */
    it("queues one kickoff for the attached conversation when the tour ends", async () => {
      guidedState = {
        paths: ["llmops"],
        donePaths: ["llmops"],
        conversationId: "conv_1",
      };
      beginPathMutateAsync.mockResolvedValue({
        paths: ["llmops", "gateway"],
        currentPath: "gateway",
        donePaths: ["llmops"],
        conversationId: "conv_1",
        provider: "openai",
        providerModel: "gpt-5",
      });
      renderOffer("gateway");
      fireEvent.click(pill()!);
      await waitFor(() =>
        expect(useGuidedTourStore.getState().running).toBe(true),
      );
      act(() => useGuidedTourStore.getState().end("completed"));
      expect(recordTourMutate).toHaveBeenCalledWith({
        organizationId: "org_1",
        status: "completed",
      });
      expect(queueGuidedKickoff).toHaveBeenCalledTimes(1);
      expect(queueGuidedKickoff).toHaveBeenCalledWith({
        path: "gateway",
        paths: ["llmops", "gateway"],
        provider: "openai",
        providerModel: "gpt-5",
        orgName: "ACME",
        firstName: "Riley",
        tourStatus: "completed",
        conversationId: "conv_1",
      });
    });
  });

  describe("when the personal pill is clicked", () => {
    /** @scenario the coding offer queues the kickoff with no tour */
    it("queues the coding kickoff right away", async () => {
      beginPathMutateAsync.mockResolvedValue({
        paths: ["coding"],
        currentPath: "coding",
        donePaths: [],
      });
      renderOffer("me");
      fireEvent.click(pill()!);
      await waitFor(() => expect(queueGuidedKickoff).toHaveBeenCalledTimes(1));
      expect(queueGuidedKickoff).toHaveBeenCalledWith(
        expect.objectContaining({ path: "coding", tourStatus: "none" }),
      );
      expect(useGuidedTourStore.getState().running).toBe(false);
    });
  });

  describe("while the begin request is in flight", () => {
    /** @scenario the offer is disabled while the path is being begun */
    it("cannot be clicked twice", async () => {
      let resolve: (v: GuidedOnboardingState) => void = () => {};
      beginPathMutateAsync.mockReturnValue(
        new Promise<GuidedOnboardingState>((r) => {
          resolve = r;
        }),
      );
      renderOffer("gateway");
      fireEvent.click(pill()!);
      await waitFor(() => expect(pill()).toBeDisabled());
      fireEvent.click(pill()!);
      expect(beginPathMutateAsync).toHaveBeenCalledTimes(1);
      act(() =>
        resolve({ paths: ["gateway"], currentPath: "gateway", donePaths: [] }),
      );
      await waitFor(() =>
        expect(useGuidedTourStore.getState().running).toBe(true),
      );
    });
  });

  describe("when the begin request fails", () => {
    /** @scenario a failed begin keeps the offer and shows the error */
    it("keeps the pill and shows the error toast", async () => {
      const error = new Error("nope");
      beginPathMutateAsync.mockRejectedValue(error);
      renderOffer("gateway");
      fireEvent.click(pill()!);
      await waitFor(() =>
        expect(showErrorToast).toHaveBeenCalledWith(
          expect.objectContaining({ error }),
        ),
      );
      expect(pill()).toBeInTheDocument();
      expect(pill()).not.toBeDisabled();
      expect(useGuidedTourStore.getState().running).toBe(false);
    });
  });
});
