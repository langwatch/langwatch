/**
 * @vitest-environment jsdom
 *
 * The breakdown panels under the cost lanes, mounted through the real page.
 *
 * Two things are under test, and both are about what the screen is allowed to
 * claim. First, the panels have to survive a real answer: the activity reads
 * hand back a wrapper object, not a list, and a panel that maps over the
 * wrapper throws the instant real data arrives — which no test caught, because
 * every existing mock answers `undefined`. Second, a panel that has not heard
 * back must not print a figure: "0 users" and "nothing in this window" are both
 * measurements, and neither has been made while a read is still in flight or
 * was never permitted to run.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** What each activity read answers. `undefined` means it has not answered. */
  activity: {
    summary: undefined as unknown,
    spendByDepartment: undefined as unknown,
    spendByUser: undefined as unknown,
    spendOverTime: undefined as unknown,
  },
  /** The spender breakdown read: its answer, whether it failed, retry spy. */
  spenders: {
    data: undefined as unknown,
    isError: false,
    refetch: undefined as unknown,
  },
  /**
   * The cost summary's lanes: whether any source is reporting a figure.
   *
   * Configurable because this is the screen's signal for whether anything is
   * connected at all, and the adoption headcount cannot state its own absence
   * — see the "count that cannot state its own absence" section of the spec.
   *
   * Lanes rather than `unavailableReason`, because the organization the defect
   * was reported on has neither structural reason set: it has a cost store and
   * a governance project, and simply nothing flowing through them. Keying the
   * fixture on the reason alone would have reproduced a case the live screen
   * was not in. Defaults to reporting, which is what every test here assumed
   * before it was a variable.
   */
  lanesReport: true,
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
      spenders: {
        useQuery: () => ({
          data: harness.spenders.data,
          isError: harness.spenders.isError,
          refetch: harness.spenders.refetch,
        }),
      },
      summary: {
        useQuery: () => ({
          data: {
            unavailableReason: null,
            billed: harness.lanesReport
              ? { amountUsd: 123.45, cellsWithoutAmount: 0 }
              : { amountUsd: null, cellsWithoutAmount: 0 },
            gateway: harness.lanesReport
              ? { amountUsd: 67.89, cellsWithoutAmount: 0 }
              : { amountUsd: null, cellsWithoutAmount: 0 },
            seats: { status: "awaiting_data" },
            series: harness.lanesReport
              ? [{ day: "2026-08-01", billedUsd: 123.45, gatewayUsd: 67.89 }]
              : [],
            windowDays: 30,
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
    activityMonitor: {
      summary: { useQuery: () => ({ data: harness.activity.summary }) },
      spendByDepartment: {
        useQuery: () => ({ data: harness.activity.spendByDepartment }),
      },
      spendByUser: {
        useQuery: () => ({ data: harness.activity.spendByUser }),
      },
      spendOverTime: {
        useQuery: () => ({ data: harness.activity.spendOverTime }),
      },
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

beforeEach(() => {
  harness.activity = {
    summary: undefined,
    spendByDepartment: undefined,
    spendByUser: undefined,
    spendOverTime: undefined,
  };
  harness.spenders = { data: undefined, isError: false, refetch: vi.fn() };
  harness.lanesReport = true;
});

afterEach(() => cleanup());

describe("the cost breakdown panels", () => {
  describe("given the activity reads answer with real figures", () => {
    beforeEach(() => {
      harness.activity.summary = {
        activeUsersThisWindow: 42,
        newUsersThisWindow: 3,
        spentThisWindowUsd: "500.00",
      };
      harness.activity.spendByDepartment = [
        {
          departmentId: "dep-1",
          departmentName: "Engineering",
          spendUsd: "310.50",
        },
        {
          departmentId: "dep-2",
          departmentName: "Support",
          spendUsd: "120.25",
        },
      ];
      harness.activity.spendByUser = [
        { actor: "ada@acme.test", spendUsd: "200.00", requests: 90 },
      ];
      // The read answers a wrapper around the buckets, not the buckets. A
      // panel that treats this as a list throws here rather than rendering.
      harness.activity.spendOverTime = {
        buckets: [
          {
            bucketIso: "2026-08-01",
            points: [
              { key: "team-a", label: "Team A", spendUsd: "310.50" },
              { key: "team-b", label: "Team B", spendUsd: "120.25" },
            ],
          },
        ],
      };
    });

    it("renders the real breakdowns instead of throwing on the wrapper", () => {
      renderScreen();

      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText("Support")).toBeInTheDocument();
      expect(screen.getByText("ada@acme.test")).toBeInTheDocument();
    });

    it("reports the measured user count", () => {
      renderScreen();

      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("never claims a real panel is empty while it holds figures", () => {
      renderScreen();

      expect(screen.queryByText("Not available.")).not.toBeInTheDocument();
    });
  });

  describe("given an activity read has not answered", () => {
    it("says so rather than printing a zero nobody measured", () => {
      renderScreen();

      // The adoption card and every real panel are unanswered here, so the
      // screen may not show "0" or claim the window held nothing.
      expect(screen.queryByText("0")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Nothing in this window yet."),
      ).not.toBeInTheDocument();
    });

    /** @scenario "An empty panel says what it holds and what would fill it" */
    it("names what each empty panel holds and what would fill it", () => {
      renderScreen();

      // The sentence a panel used to show instead. It named neither the panel
      // nor what would fill it, so a reader's next move on seeing it was to
      // report a bug against a screen working exactly as designed.
      expect(screen.queryByText("Not available.")).not.toBeInTheDocument();
      expect(
        screen.getByText("Spend per model, largest first."),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Fills from gateway traffic and from usage rows that name a model.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("link", { name: /Add a source/ }).length,
      ).toBeGreaterThan(0);
    });
  });

  describe("given an activity read answers with no rows", () => {
    it("reports the window as empty, which it measured", () => {
      harness.activity.summary = {
        activeUsersThisWindow: 0,
        newUsersThisWindow: 0,
        spentThisWindowUsd: "0",
      };
      harness.activity.spendByDepartment = [];
      harness.activity.spendByUser = [];
      harness.activity.spendOverTime = { buckets: [] };

      renderScreen();

      expect(
        screen.getAllByText("Nothing in this window yet.").length,
      ).toBeGreaterThan(0);
    });
  });

  /**
   * The adoption headcount is the one figure here that cannot say "unmeasured"
   * — the activity summary types it as a plain number and zero-fills it when
   * nothing is connected. So these two cases send the SAME zero and differ
   * only in whether a source is behind it, which is the whole rule.
   */
  describe("given the activity read answers zero active people", () => {
    beforeEach(() => {
      harness.activity.summary = {
        activeUsersThisWindow: 0,
        newUsersThisWindow: 0,
        spentThisWindowUsd: "0",
      };
      harness.activity.spendByDepartment = [];
      harness.activity.spendByUser = [];
      harness.activity.spendOverTime = { buckets: [] };
    });

    /** @scenario "An adoption count of zero from a connected source is shown as the measurement it is" */
    it("shows the zero when a source is connected, because a quiet window is a finding", () => {
      harness.lanesReport = true;

      renderScreen();

      const adoption = screen
        .getByText("People using AI tools")
        .closest("[data-testid='cost-panel']");
      expect(adoption).not.toBeNull();
      expect(
        within(adoption as HTMLElement).getByText("0"),
      ).toBeInTheDocument();
      // An organization that already has a source must not be told to add one.
      expect(
        within(adoption as HTMLElement).queryByRole("link", {
          name: /Add a source/,
        }),
      ).not.toBeInTheDocument();
    });

    /** @scenario "An adoption count of zero with nothing connected is not reported as a measurement" */
    it("withholds the same zero when nothing is connected, and names what would fill it", async () => {
      harness.lanesReport = false;

      renderScreen();

      const adoption = screen
        .getByText("Adoption")
        .closest("[data-testid='cost-panel']") as HTMLElement;
      // No headcount, and no label standing over a blank where one was.
      expect(within(adoption).queryByText("0")).not.toBeInTheDocument();
      expect(
        within(adoption).queryByText("People using AI tools"),
      ).not.toBeInTheDocument();
      expect(
        within(adoption).getByText(
          "How many people used an AI tool in this period.",
        ),
      ).toBeInTheDocument();
      expect(
        within(adoption).getByText(
          "Fills from the activity a connected source reports.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("given the spender breakdown answers with rows", () => {
    beforeEach(() => {
      harness.spenders.data = {
        rows: [
          {
            provider: "openai_admin",
            rawActorId: "u_ada",
            label: "ada@acme.test",
            agentId: "",
            amountUsd: 4,
            cellsWithoutAmount: 0,
          },
          {
            provider: "databricks",
            rawActorId: "ada@acme.test",
            label: "ada@acme.test",
            agentId: "",
            amountUsd: 6,
            cellsWithoutAmount: 0,
          },
          // Spend the provider attributed to no credential at all. It is on
          // every real version of this list, so it is on this one.
          {
            provider: "",
            rawActorId: "",
            label: null,
            agentId: "",
            amountUsd: 3,
            cellsWithoutAmount: 0,
          },
        ],
        windowDays: 30,
      };
    });

    it("names each row's provider, so one key billed at two providers is not a duplicate", () => {
      renderScreen();

      expect(screen.getByText("openai_admin")).toBeInTheDocument();
      expect(screen.getByText("databricks")).toBeInTheDocument();
    });

    /** @scenario "The billed breakdown names the key the provider charged, not a person" */
    it("titles the panel for the key, and says so on the row naming none", () => {
      renderScreen();

      // An invoice records which credential was presented, never who was
      // holding it. Titling this by person promised an attribution the
      // billing pipeline cannot make — a key four engineers share billed as
      // one person's spend.
      expect(screen.getByText("Billed spend by API key")).toBeInTheDocument();
      expect(
        screen.queryByText("Billed spend by person"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("No key named")).toBeInTheDocument();
      // "Metered spend by person" is a different panel and stays by person on
      // purpose: it reads cost recorded on traces as they were served, where
      // the actor IS known. Only the invoice cannot name one.
      expect(screen.getByText("Metered spend by person")).toBeInTheDocument();
    });
  });

  describe("given the spender breakdown read fails", () => {
    beforeEach(() => {
      harness.spenders.isError = true;
    });

    it("says the read failed instead of vanishing as if nobody spent anything", () => {
      renderScreen();

      expect(screen.getByText("Billed spend by API key")).toBeInTheDocument();
      expect(screen.getByTestId("cost-spenders-error")).toBeInTheDocument();
    });

    it("offers a retry that asks the read to run again", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(harness.spenders.refetch).toHaveBeenCalled();
    });
  });

  describe("given the window answers with days but nothing spent on any of them", () => {
    it("says the window is empty rather than drawing bare axes", () => {
      // The read answered, and it answered with a full window — one bucket per
      // day, no spend on any. There is a row per day and no series to plot, so
      // a length check on the rows alone lets this through and the panel draws
      // an axis with nothing above it, which reads as a chart that broke.
      harness.activity.summary = {
        activeUsersThisWindow: 4,
        newUsersThisWindow: 1,
        spentThisWindowUsd: "0",
      };
      harness.activity.spendByDepartment = [
        {
          departmentId: "dep-1",
          departmentName: "Engineering",
          spendUsd: "410.00",
        },
      ];
      harness.activity.spendByUser = [
        { actor: "ada@acme.test", spendUsd: "200.00", requests: 90 },
      ];
      harness.activity.spendOverTime = {
        buckets: [
          { bucketIso: "2026-08-01", points: [] },
          { bucketIso: "2026-08-02", points: [] },
        ],
      };

      renderScreen();

      // Scoped to this panel on purpose. Other panels are empty for their own
      // reasons and print the same sentence, so a page-wide search for it
      // passes whether or not this panel drew bare axes.
      const panel = screen
        .getByText("Cost over time · by team")
        .closest('[data-testid="cost-panel"]');

      expect(panel).not.toBeNull();
      expect(
        within(panel as HTMLElement).getByText("Nothing in this window yet."),
      ).toBeInTheDocument();
    });
  });
});
