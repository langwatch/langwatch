/**
 * @vitest-environment jsdom
 *
 * The host's landing logic: what it does with the guided state when it
 * mounts, and what it never does (on /onboarding, in the classic variant,
 * twice for the same path).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";

const emitMock = vi.fn();
vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: React.ReactNode }) => children,
  useAnalytics: () => ({ emit: emitMock }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

let pathname = "/acme-checkout/traces";
vi.mock("~/utils/compat/next-navigation", () => ({
  usePathname: () => pathname,
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

let guidedState: GuidedOnboardingState = { paths: [], donePaths: [] };
const recordTourMutate = vi.fn();
const invalidate = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      onboarding: { getGuidedState: { invalidate } },
    }),
    onboarding: {
      getGuidedState: {
        useQuery: () => ({ data: guidedState, isLoading: false }),
      },
      recordTour: { useMutation: () => ({ mutate: recordTourMutate }) },
    },
  },
}));

const queueGuidedKickoff = vi.fn();
const openPanel = vi.fn();
const setPanelMode = vi.fn();
vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: {
    getState: () => ({ queueGuidedKickoff, openPanel, setPanelMode }),
  },
}));

import { GuidedOnboardingHost } from "../GuidedOnboardingHost";
import { useGuidedTourStore } from "../guidedTourStore";

function renderHost() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <GuidedOnboardingHost />
    </ChakraProvider>,
  );
}

describe("GuidedOnboardingHost", () => {
  beforeEach(() => {
    pathname = "/acme-checkout/traces";
    flagEnabled = true;
    guidedState = { paths: ["llmops"], currentPath: "llmops", donePaths: [] };
    queueGuidedKickoff.mockReset();
    openPanel.mockReset();
    setPanelMode.mockReset();
    recordTourMutate.mockReset();
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

  describe("given a fresh landing on a path with a tour", () => {
    /** @scenario the host opens the panel docked before the tour starts */
    it("opens the panel in sidebar mode and starts the tour", () => {
      renderHost();
      expect(openPanel).toHaveBeenCalled();
      expect(setPanelMode).toHaveBeenCalledWith("sidebar");
      const s = useGuidedTourStore.getState();
      expect(s.running).toBe(true);
      expect(s.path).toBe("llmops");
    });

    /** @scenario the kickoff is queued exactly once when the tour ends */
    it("records the tour and queues one kickoff when the tour ends", () => {
      guidedState = {
        paths: ["llmops", "gateway"],
        currentPath: "llmops",
        donePaths: [],
        provider: "openai",
        providerModel: "gpt-5",
      };
      const { rerender } = renderHost();
      useGuidedTourStore.getState().end("completed");
      expect(recordTourMutate).toHaveBeenCalledWith({
        organizationId: "org_1",
        status: "completed",
      });
      expect(queueGuidedKickoff).toHaveBeenCalledTimes(1);
      expect(queueGuidedKickoff).toHaveBeenCalledWith({
        path: "llmops",
        paths: ["llmops", "gateway"],
        provider: "openai",
        providerModel: "gpt-5",
        orgName: "ACME",
        firstName: "Riley",
        tourStatus: "completed",
        conversationId: null,
      });
      rerender(
        <ChakraProvider value={defaultSystem}>
          <GuidedOnboardingHost />
        </ChakraProvider>,
      );
      expect(queueGuidedKickoff).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the coding path", () => {
    /** @scenario the coding path queues the kickoff with no tour */
    it("queues the kickoff right away with tour status none", () => {
      guidedState = { paths: ["coding"], currentPath: "coding", donePaths: [] };
      renderHost();
      expect(useGuidedTourStore.getState().running).toBe(false);
      expect(queueGuidedKickoff).toHaveBeenCalledWith(
        expect.objectContaining({ path: "coding", tourStatus: "none" }),
      );
    });
  });

  describe("given the provider screen was skipped", () => {
    /** @scenario a skipped provider means no tour */
    it("runs no tour and queues the kickoff as skipped", () => {
      guidedState = {
        paths: ["gateway"],
        currentPath: "gateway",
        donePaths: [],
        providerSkippedAt: "2026-09-05T10:00:00.000Z",
        tourSkippedAt: "2026-09-05T10:00:00.000Z",
      };
      renderHost();
      expect(useGuidedTourStore.getState().running).toBe(false);
      expect(openPanel).toHaveBeenCalled();
      expect(queueGuidedKickoff).toHaveBeenCalledTimes(1);
      expect(queueGuidedKickoff).toHaveBeenCalledWith(
        expect.objectContaining({ path: "gateway", tourStatus: "skipped" }),
      );
    });
  });

  describe("given the tour already ended", () => {
    /** @scenario a reload after the tour queues the kickoff again only while no conversation is attached */
    it("queues the kickoff without a tour while no conversation is attached", () => {
      guidedState = {
        paths: ["llmops"],
        currentPath: "llmops",
        donePaths: [],
        tourSkippedAt: "2026-09-05T10:00:00.000Z",
      };
      renderHost();
      expect(useGuidedTourStore.getState().running).toBe(false);
      expect(queueGuidedKickoff).toHaveBeenCalledWith(
        expect.objectContaining({ path: "llmops", tourStatus: "skipped" }),
      );
    });

    /** @scenario the tour never runs twice for the same path */
    it("neither runs the tour nor queues once a conversation is attached", () => {
      guidedState = {
        paths: ["llmops"],
        currentPath: "llmops",
        donePaths: [],
        tourCompletedAt: "2026-09-05T10:00:00.000Z",
        conversationId: "conv_1",
      };
      renderHost();
      expect(useGuidedTourStore.getState().running).toBe(false);
      expect(queueGuidedKickoff).not.toHaveBeenCalled();
    });
  });

  describe("given the onboarding screens", () => {
    /** @scenario the tour never runs on the onboarding screens */
    it("does nothing under /onboarding", () => {
      pathname = "/onboarding/welcome";
      const { container } = renderHost();
      expect(useGuidedTourStore.getState().running).toBe(false);
      expect(queueGuidedKickoff).not.toHaveBeenCalled();
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("given the classic variant", () => {
    /** @scenario the classic variant never runs the tour */
    it("does nothing when the flag is off", () => {
      flagEnabled = false;
      renderHost();
      expect(useGuidedTourStore.getState().running).toBe(false);
      expect(queueGuidedKickoff).not.toHaveBeenCalled();
      expect(openPanel).not.toHaveBeenCalled();
    });
  });
});
