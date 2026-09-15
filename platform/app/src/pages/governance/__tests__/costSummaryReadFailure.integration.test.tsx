/**
 * @vitest-environment jsdom
 *
 * What the token panel shows when the summary read behind it does not answer.
 *
 * The panel has no read of its own: it folds the per-day series the money
 * lanes read, and that series arrives as null whenever the read failed before
 * ever answering. Null is this screen's word for "not measured yet", so a
 * broken read was printed as a panel patiently waiting for traffic — while the
 * lanes one screen above it said, correctly, that the read had failed. A
 * reader believing the panel goes off to check why nothing is flowing through
 * a gateway that is in fact flowing fine.
 *
 * The second case is the one that earns the guard rather than a null check. On
 * a refetch failure the last successful series is still in hand, so a failure
 * and a drawable series are both true at once, and the branch that draws real
 * figures has to stand down anyway — otherwise figures nobody could confirm
 * are presented as current.
 *
 * The last two cases pin what the flag must NOT swallow: sample mode outranks
 * it, and a refused read is not a failure at all.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { GovernanceCostDayDto } from "@ee/governance/services/governanceCost.service";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costDay, costSummaryAnswer } from "./costFixtures";

/**
 * The days a successful read answers with.
 *
 * Typed as the DTO rather than left inline: an untyped day missing a field the
 * chart folds draws NaN and still passes every "this panel is not empty"
 * assertion, which is how the token chart broke once already.
 */
const TOKEN_DAYS: GovernanceCostDayDto[] = [
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
   * The summary read. Its answer, its failure and the failure's code are set
   * INDEPENDENTLY on purpose: a failed refetch still holds the answer the last
   * successful read returned, and a refusal is a failure whose code says
   * retrying cannot help.
   */
  summary: {
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
      summary: {
        useQuery: () => ({
          data: harness.summary.data,
          isLoading: false,
          isError: harness.summary.isError,
          error: harness.summary.error,
        }),
      },
    },
    activityMonitor: {
      // The adoption card reads this one; it has its own test file.
      summary: {
        useQuery: () => ({ data: undefined, isError: false, error: null }),
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

/** Presses the toggle rather than seeding the stored choice, as a reader does. */
const renderInSampleMode = async () => {
  const rendered = renderScreen();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "See sample data" }));
  return rendered;
};

/**
 * The card the token panel lives in, found by its heading.
 *
 * Scoped rather than searched page-wide because the unrefreshed marker is what
 * EVERY panel on this screen shows for a failed read, so an unscoped search
 * for it passes on a neighbour's failure.
 */
const tokenPanel = () => {
  const card = screen
    .getByText("Tokens over time")
    .closest<HTMLElement>('[data-testid="cost-panel"]');
  if (card === null) {
    throw new Error("the token heading stands outside any cost panel");
  }
  return within(card);
};

/** The panel beside it, which has no read behind it in any of these cases. */
const conversationPanel = () => {
  const card = screen
    .getByText("Conversations over time")
    .closest<HTMLElement>('[data-testid="cost-panel"]');
  if (card === null) {
    throw new Error("the conversation heading stands outside any cost panel");
  }
  return within(card);
};

beforeEach(() => {
  harness.summary = { data: undefined, isError: false, error: null };
  // The section keeps one sample choice for the whole sitting in session
  // storage, so a test that presses the toggle would otherwise hand its answer
  // to every test after it.
  window.sessionStorage.clear();
});

afterEach(() => cleanup());

describe("the tokens over time panel", () => {
  describe("given the summary read failed before it ever answered", () => {
    beforeEach(() => {
      harness.summary = {
        data: undefined,
        isError: true,
        error: { data: { code: "INTERNAL_SERVER_ERROR" } },
      };
    });

    /** @scenario "A failed read is never shown as a read that has not happened yet" */
    it("says it could not be brought up to date rather than waiting on traffic", () => {
      renderScreen();
      const panel = tokenPanel();

      expect(
        panel.getByText(/could not be brought up to date/i),
      ).toBeInTheDocument();
      // The defect itself: a failed read arrives as a null series, and null is
      // this screen's word for "not read yet", so the panel invited the reader
      // to wait for traffic that had already been measured and lost.
      expect(
        panel.queryByText("How many tokens were spent, period by period."),
      ).not.toBeInTheDocument();
      // Nor does it collapse the other way, into the measured-empty state,
      // which would report a finding about a window nobody read.
      expect(
        panel.queryByText("Nothing in this window yet."),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A panel that fails to refresh says so instead of emptying" */
    it("leaves the panel beside it saying what it has always said", () => {
      renderScreen();

      // The conversation panel has no read behind it at all, so a failure it
      // took no part in must not reach it — and its still-unanswered copy is
      // what proves this screen did not simply fail as a whole.
      expect(
        conversationPanel().getByText(
          "How many conversations were held, period by period.",
        ),
      ).toBeInTheDocument();
      expect(
        conversationPanel().queryByText(/could not be brought up to date/i),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the read failed while still holding the series it last returned", () => {
    beforeEach(() => {
      harness.summary = {
        data: costSummaryAnswer(TOKEN_DAYS),
        isError: true,
        error: { data: { code: "INTERNAL_SERVER_ERROR" } },
      };
    });

    /** @scenario "A failed read is never shown as a read that has not happened yet" */
    it("shows the marker and not the figures it could not confirm", () => {
      renderScreen();
      const panel = tokenPanel();

      expect(
        panel.getByText(/could not be brought up to date/i),
      ).toBeInTheDocument();
      // Drawing the chart alongside the marker would state two contradictory
      // things at once, and drawing it without the marker would present
      // figures from before the failure as current. The panel's own label for
      // those figures is what says whether they are being presented.
      expect(
        panel.queryByText("Counted by the gateway as it served the traffic."),
      ).not.toBeInTheDocument();
      // And it is the marker, not either empty state: an empty panel here
      // would claim a measurement of a window this read never delivered.
      expect(panel.queryByTestId("cost-panel-empty")).not.toBeInTheDocument();
    });
  });

  describe("when sample mode is on over a failed read", () => {
    beforeEach(() => {
      harness.summary = {
        data: undefined,
        isError: true,
        error: { data: { code: "INTERNAL_SERVER_ERROR" } },
      };
    });

    /** @scenario "No error alert is rendered while sample mode is on" */
    it("draws the invented series and says nothing about the failure", async () => {
      await renderInSampleMode();

      const panel = tokenPanel();

      expect(
        panel.queryByText(/could not be brought up to date/i),
      ).not.toBeInTheDocument();
      expect(
        panel.getByText("Counted by the gateway as it served the traffic."),
      ).toBeInTheDocument();
    });
  });

  describe("given the read was declined rather than broken", () => {
    beforeEach(() => {
      harness.summary = {
        data: undefined,
        isError: true,
        error: { data: { code: "FORBIDDEN" } },
      };
    });

    /** @scenario "A declined summary read leaves its panels saying what would fill them" */
    it("keeps its empty copy instead of advising a refresh that cannot help", () => {
      renderScreen();
      const panel = tokenPanel();

      // Nothing failed and nothing needs retrying, so the marker's advice —
      // that refreshing again is worth a try — would send this reader after a
      // fix that does not exist. The same line `SpenderPanelBody` draws.
      expect(
        panel.queryByText(/could not be brought up to date/i),
      ).not.toBeInTheDocument();
      expect(
        panel.getByText("How many tokens were spent, period by period."),
      ).toBeInTheDocument();
    });
  });
});
