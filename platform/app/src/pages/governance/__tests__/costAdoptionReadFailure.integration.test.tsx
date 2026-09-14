/**
 * @vitest-environment jsdom
 *
 * What the adoption card shows when the read behind its headcount does not
 * answer.
 *
 * The headcount folds the ACTIVITY summary, a different read from the one the
 * money lanes use, and that read's failure was not carried at all: the three
 * breakdown reads beside it each had their failure named and this one did not.
 * So a broken read left `activeUsers` null, null is this screen's word for "not
 * measured yet", and the card told a reader whose source was connected and
 * reporting to go and connect a source.
 *
 * The cost summary answers normally throughout, which is what makes the advice
 * harmful rather than merely wrong: the lanes beside this card are drawing real
 * figures at the same time.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { GovernanceCostDayDto } from "@ee/governance/services/governanceCost.service";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costDay, costSummaryAnswer } from "./costFixtures";

/** The window the money lanes answer with while the activity read is failing. */
const PRICED_DAYS: GovernanceCostDayDto[] = [
  costDay({
    day: "2026-01-15",
    billedUsd: 90,
    gatewayUsd: 67.89,
    gatewayTokens: 1_200_000,
  }),
  costDay({
    day: "2026-01-16",
    billedUsd: 30,
    gatewayUsd: 12.34,
    gatewayTokens: 400_000,
  }),
];

const harness = vi.hoisted(() => ({
  /**
   * The activity summary, which the adoption headcount is read off. Its answer
   * and its failure are set independently, the way the query hook reports them.
   */
  activitySummary: {
    data: undefined as unknown,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));
vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    governanceCost: {
      // Each has its own panel and its own tests; nothing here.
      spendByModel: { useQuery: () => ({ data: undefined }) },
      spenders: {
        useQuery: () => ({
          data: undefined,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      dailyByProvider: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isError: false,
        }),
      },
      periodRecords: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isError: false,
        }),
      },
      // The money read answers throughout: only the activity read is varied.
      summary: {
        useQuery: () => ({
          data: costSummaryAnswer(PRICED_DAYS),
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
    activityMonitor: {
      summary: {
        useQuery: () => ({
          data: harness.activitySummary.data,
          isError: harness.activitySummary.isError,
          error: harness.activitySummary.error,
        }),
      },
      spendByDepartment: { useQuery: () => ({ data: undefined }) },
      spendByUser: { useQuery: () => ({ data: undefined }) },
      spendOverTime: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

import CostsPage from "../costs";

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CostsPage />
    </ChakraProvider>,
  );

/**
 * The adoption card, found by its heading.
 *
 * Scoped rather than searched page-wide because the unrefreshed marker is what
 * EVERY panel on this screen shows for a failed read, so an unscoped search for
 * it passes on a neighbour's failure.
 */
const adoptionPanel = () => {
  const card = screen
    .getByText("Adoption")
    .closest<HTMLElement>('[data-testid="cost-panel"]');
  if (card === null) {
    throw new Error("the adoption heading stands outside any cost panel");
  }
  return within(card);
};

beforeEach(() => {
  harness.activitySummary = { data: undefined, isError: false, error: null };
});

afterEach(() => cleanup());

describe("the adoption card", () => {
  describe("given the read behind its headcount failed", () => {
    beforeEach(() => {
      harness.activitySummary = {
        data: undefined,
        isError: true,
        error: { data: { code: "INTERNAL_SERVER_ERROR" } },
      };
    });

    /** @scenario "A failed read is never shown as a read that has not happened yet" */
    it("says it could not be brought up to date rather than asking for a source", () => {
      renderScreen();
      const panel = adoptionPanel();

      expect(
        panel.getByText(/could not be brought up to date/i),
      ).toBeInTheDocument();
      // The advice is the harm: this organization's sources are connected and
      // reporting — the cost lanes beside this card are drawing their figures
      // — so sending the reader off to add one costs them the real cause.
      expect(
        panel.queryByText(
          "Fills from the activity a connected source reports.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("given that read simply has not answered yet", () => {
    it("keeps the copy that names what would fill it", () => {
      renderScreen();
      const panel = adoptionPanel();

      // The state the failure must not be collapsed into, and the one the
      // failure used to be reported as.
      expect(
        panel.getByText("Fills from the activity a connected source reports."),
      ).toBeInTheDocument();
      expect(
        panel.queryByText(/could not be brought up to date/i),
      ).not.toBeInTheDocument();
    });
  });
});
