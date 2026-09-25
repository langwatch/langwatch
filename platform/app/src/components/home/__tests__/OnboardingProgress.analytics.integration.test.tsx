/**
 * @vitest-environment jsdom
 *
 * The onboarding progress card reports the organization's onboarding variant
 * on its view event, read from the same check status it already fetches, so
 * the A/B splits this view by variant without a second query.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitMock = vi.fn();
const checkStatus = {
  current: {} as Record<string, unknown>,
};

vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme-checkout" },
  }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    integrationsChecks: {
      getCheckStatus: {
        useQuery: () => ({ data: checkStatus.current, isLoading: false }),
      },
    },
  },
}));

import { OnboardingProgress } from "../OnboardingProgress";

const baseStatus = {
  workflows: 0,
  customGraphs: 0,
  datasets: 0,
  onlineEvaluations: 0,
  triggers: 0,
  simulations: 0,
  modelProviders: 0,
  prompts: 0,
  teamMembers: 1,
  firstMessage: false,
  integrated: false,
};

function viewedPayload(): Record<string, unknown> {
  const call = emitMock.mock.calls.find(
    ([action, name]) => action === "viewed" && name === "onboarding_progress",
  );
  if (!call) throw new Error("viewed onboarding_progress was never emitted");
  return call[2];
}

function renderCard() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <OnboardingProgress />
    </ChakraProvider>,
  );
}

describe("OnboardingProgress analytics", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the check status carries the guided variant", () => {
    beforeEach(() => {
      checkStatus.current = {
        ...baseStatus,
        guidedOnboarding: {
          variant: "guided",
          paths: ["llmops"],
          currentPath: "llmops",
          donePaths: [],
        },
      };
    });

    /** @scenario "the onboarding progress view carries the onboarding variant" */
    it("reports onboarding_variant guided on the view event", async () => {
      renderCard();

      await waitFor(() => {
        expect(viewedPayload()).toMatchObject({
          project_id: "project-1",
          onboarding_variant: "guided",
        });
      });
    });
  });

  describe("given the organization predates the experiment", () => {
    beforeEach(() => {
      checkStatus.current = {
        ...baseStatus,
        guidedOnboarding: {
          variant: null,
          paths: [],
          donePaths: [],
        },
      };
    });

    it("reports no onboarding_variant on the view event", async () => {
      renderCard();

      await waitFor(() => {
        expect(viewedPayload()).not.toHaveProperty("onboarding_variant");
      });
    });
  });
});
