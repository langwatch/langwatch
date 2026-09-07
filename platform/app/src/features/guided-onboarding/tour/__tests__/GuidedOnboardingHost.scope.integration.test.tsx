/**
 * @vitest-environment jsdom
 *
 * The host against the real Langy store: the layout announces the page's
 * scope from an effect that runs after the host's, and the announcement
 * resets every scoped field. A kickoff the landing owes right away (no tour
 * to run first) has to survive that.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";

vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: React.ReactNode }) => children,
  useAnalytics: () => ({ emit: vi.fn() }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/utils/compat/next-navigation", () => ({
  usePathname: () => "/acme-checkout/gateway",
}));
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
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
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      onboarding: { getGuidedState: { invalidate: vi.fn() } },
    }),
    onboarding: {
      getGuidedState: {
        useQuery: () => ({ data: guidedState, isLoading: false }),
      },
      recordTour: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import { useLangyStore } from "~/features/langy/stores/langyStore";
import { GuidedOnboardingHost } from "../GuidedOnboardingHost";
import { useGuidedTourStore } from "../guidedTourStore";

const scope = {
  userId: "user_1",
  organizationId: "org_1",
  projectId: "proj_1",
};

function renderHost() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <GuidedOnboardingHost />
    </ChakraProvider>,
  );
}

describe("GuidedOnboardingHost with the real Langy store", () => {
  beforeEach(() => {
    guidedState = {
      paths: ["gateway"],
      currentPath: "gateway",
      donePaths: [],
      providerSkippedAt: "2026-09-05T10:00:00.000Z",
      tourSkippedAt: "2026-09-05T10:00:00.000Z",
    };
    useLangyStore.setState({
      isOpen: false,
      pendingKickoff: null,
      activeConversationScope: null,
      scopeAnnounced: false,
    });
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

  describe("given the provider was skipped and the scope is not announced yet", () => {
    /** @scenario a kickoff owed right away waits for Langy to announce the page's scope */
    it("opens the panel, queues once the scope is announced, and keeps the kickoff through a repeat", () => {
      renderHost();
      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(useLangyStore.getState().pendingKickoff).toBeNull();

      act(() => useLangyStore.getState().resetForScope(scope));
      expect(useLangyStore.getState().pendingKickoff).toMatchObject({
        path: "gateway",
        tourStatus: "skipped",
      });
      expect(useLangyStore.getState().isOpen).toBe(true);

      act(() => useLangyStore.getState().resetForProject("proj_1"));
      expect(useLangyStore.getState().pendingKickoff).toMatchObject({
        path: "gateway",
        tourStatus: "skipped",
      });
    });

    it("waits even when the persisted scope already names this page", () => {
      useLangyStore.setState({
        activeConversationScope: scope,
        scopeAnnounced: false,
      });
      renderHost();
      expect(useLangyStore.getState().pendingKickoff).toBeNull();

      act(() => useLangyStore.getState().resetForScope(scope));
      expect(useLangyStore.getState().pendingKickoff).toMatchObject({
        path: "gateway",
        tourStatus: "skipped",
      });
    });
  });

  describe("given the scope was announced before the host mounted", () => {
    it("queues the kickoff right away", () => {
      act(() => useLangyStore.getState().resetForScope(scope));
      renderHost();
      expect(useLangyStore.getState().pendingKickoff).toMatchObject({
        path: "gateway",
        tourStatus: "skipped",
      });
    });
  });
});
