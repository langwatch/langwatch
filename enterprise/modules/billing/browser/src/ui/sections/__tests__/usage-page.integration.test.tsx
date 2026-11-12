/**
 * @vitest-environment jsdom
 * The usage page on hosted: the plan strip, the month, each project and the seats.
 * @see specs/licensing/usage-page.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { StripeEnvironment } from "@langwatch/enterprise-billing-contract";
import type { UsageMonthBreakdown } from "@langwatch/entitlement-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BillingHostApi,
  BillingHostProvider,
  type BillingHostOrganization,
} from "../../../model/billing-host.ts";
import UsageScreen from "../usage.screen.tsx";

type MockPlan = {
  planSource: "free" | "subscription" | "license";
  type: string;
  name: string;
  free: boolean;
  maxMembers: number;
  maxMembersLite: number;
  maxMessagesPerMonth: number;
};

const FREE_PLAN: MockPlan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 2,
  maxMembersLite: 0,
  maxMessagesPerMonth: 50_000,
};

const GROWTH_PLAN: MockPlan = {
  planSource: "subscription",
  type: "GROWTH_SEAT_EUR_MONTHLY",
  name: "Growth",
  free: false,
  maxMembers: 3,
  maxMembersLite: 9_999,
  maxMessagesPerMonth: 999_999_999,
};

const TIERED_PLAN: MockPlan = {
  planSource: "subscription",
  type: "LAUNCH",
  name: "Launch",
  free: false,
  maxMembers: 3,
  maxMembersLite: 9_999,
  maxMessagesPerMonth: 20_000,
};

function month(days: Record<string, number>): UsageMonthBreakdown {
  return {
    resetsOn: "2026-12-01",
    isDailyUnavailable: false,
    byCategory: null,
    isByCategoryUnavailable: false,
    days: Array.from({ length: 30 }, (_, index) => {
      const date = `2026-11-${String(index + 1).padStart(2, "0")}`;
      return { date, count: days[date] ?? 0 };
    }),
    projects: [
      { projectId: "p1", name: "support-agent", count: 19_800 },
      { projectId: "p2", name: "triage", count: 8_200 },
      { projectId: "p3", name: "content", count: 3_800 },
    ],
  };
}

const state = vi.hoisted(() => ({
  pricingModel: "SEAT_EVENT" as string | null,
  plan: undefined as unknown,
  usage: undefined as unknown,
  usageError: false,
  breakdown: undefined as unknown,
  isAdmin: true,
  breakdownError: false,
}));

vi.mock("@langwatch/auth-client", () => ({ useRecordPageOpened: () => undefined }));
vi.mock("../../../behavior/billing-api.ts", () => {
  const answer = (read: () => unknown) => ({
    useQuery: () => ({ data: read(), isLoading: false, isError: false }),
  });
  return {
    billingApi: {
      plan: { getActivePlan: answer(() => state.plan) },
      limits: {
        getUsage: {
          useQuery: () =>
            state.usageError
              ? { data: undefined, isLoading: false, isError: true }
              : { data: state.usage, isLoading: false, isError: false },
        },
        getMonthBreakdown: {
          useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
            data: options.enabled && !state.breakdownError ? state.breakdown : undefined,
            isLoading: false,
            isError: !!options.enabled && state.breakdownError,
          }),
        },
      },
      license: { getStatus: answer(() => undefined) },
      currency: { detectCurrency: answer(() => ({ currency: "EUR" })) },
    },
  };
});
vi.mock("../../../behavior/use-billing-pricing-service.ts", () => ({
  useBillingPricingService: () => ({
    getGrowthSeatPriceCents: () => ({
      EUR: { monthly: 2_900, annual: 31_320 },
      USD: { monthly: 3_200, annual: 34_560 },
    }),
  }),
}));
/** A hosted organization; `isAdmin` decides whether the reader holds `organization:manage`. */
class TestBillingHost extends BillingHostApi {
  constructor(private readonly isAdmin: boolean) {
    super();
  }
  organization(): BillingHostOrganization {
    return {
      id: "org-1",
      name: "QA Org",
      pricingModel: state.pricingModel as BillingHostOrganization["pricingModel"],
    };
  }
  activeTeamId(): string | undefined {
    return undefined;
  }
  canInviteMembers(): boolean {
    return this.isAdmin;
  }
  canReadMonthBreakdown(): boolean {
    return this.isAdmin;
  }
  canReadHeldSeats(): boolean {
    return this.isAdmin;
  }
  routeQuery(): Readonly<Record<string, string | undefined>> {
    return {};
  }
  isSaaS(): boolean {
    return true;
  }
  isDeploymentSettled(): boolean {
    return true;
  }
  stripeEnvironment(): StripeEnvironment {
    return "test";
  }
  navigate(): void {}
  replace(): void {}
  leaveTo(): void {}
  applicationOrigin(): string {
    return "http://localhost";
  }
  succeeded(): void {}
  failed(): void {}
}

function usageOf({
  plan,
  count,
  members = 1,
  lite = 0,
  usageUnit = "events",
}: {
  plan: MockPlan;
  count: number | null;
  members?: number;
  lite?: number;
  usageUnit?: "events" | "traces";
}) {
  return {
    activePlan: plan,
    usageUnit,
    membersCount: members,
    membersLiteCount: lite,
    currentMonthMessagesCount: count,
  };
}

function given({
  plan,
  count,
  members,
  lite,
  pricingModel = "SEAT_EVENT",
  usageUnit,
  breakdown = month({ "2026-11-01": 3_100, "2026-11-02": 4_800, "2026-11-03": 6_200 }),
}: {
  plan: MockPlan;
  count: number | null;
  members?: number;
  lite?: number;
  pricingModel?: string | null;
  usageUnit?: "events" | "traces";
  breakdown?: UsageMonthBreakdown;
}) {
  state.plan = plan;
  state.usage = usageOf({ plan, count, members, lite, usageUnit });
  state.pricingModel = pricingModel;
  state.breakdown = breakdown;
}

const renderPage = () =>
  render(<UsageScreen />, {
    wrapper: ({ children }) => (
      <DesignSystemProvider forcedTheme="light">
        <BillingHostProvider value={new TestBillingHost(state.isAdmin)}>
          {children}
        </BillingHostProvider>
      </DesignSystemProvider>
    ),
  });

beforeEach(() => {
  state.usageError = false;
  state.isAdmin = true;
  state.breakdownError = false;
});
afterEach(() => cleanup());

describe("the usage page", () => {
  describe("given a Free organization", () => {
    beforeEach(() => given({ plan: FREE_PLAN, count: 31_800 }));

    /** @scenario "A Free organization sees its plan and the upgrade on top" */
    it("leads with the Free plan, what it includes and the upgrade that opens the Growth seat dialog", () => {
      renderPage();

      const strip = screen.getByTestId("usage-plan-strip");
      expect(within(strip).getByText("Free plan")).toBeInTheDocument();
      expect(within(strip).getByText("Current")).toBeInTheDocument();
      expect(screen.getByTestId("usage-plan-summary")).toHaveTextContent(
        "€0 · 50,000 events and 2 full seats a month",
      );
      expect(screen.getByTestId("usage-upgrade-button")).toHaveTextContent("Upgrade to Growth");
      expect(screen.getByTestId("usage-upgrade-button")).toHaveAttribute(
        "href",
        "/settings/subscription?checkout=growth",
      );
      expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    });

    /** @scenario "Events this month are shown against the allowance, day by day" */
    it("shows the month against the allowance with a meter, a bar per day and the reset", () => {
      renderPage();

      const card = screen.getByTestId("usage-events-card");
      expect(screen.getByTestId("usage-events-count")).toHaveTextContent("31,800");
      expect(within(card).getByText("of 50,000 included")).toBeInTheDocument();
      expect(screen.getByTestId("usage-events-meter")).toBeInTheDocument();
      expect(screen.getAllByTestId("daily-bar")).toHaveLength(30);
      expect(within(card).getByText("Resets on 1 Dec")).toBeInTheDocument();
    });

    /** @scenario "Each project's share of the month is listed, the busiest first" */
    it("lists each project with events, the busiest first", () => {
      renderPage();

      const rows = screen.getAllByTestId("usage-project-row");
      expect(rows.map((row) => row.textContent)).toEqual([
        "support-agent19,800",
        "triage8,200",
        "content3,800",
      ]);
    });

    /** @scenario "Full seats in use are shown against the plan with a link to Users" */
    it("shows the full seats against the plan and links to Users", () => {
      renderPage();

      expect(screen.getByTestId("usage-full-seats")).toHaveTextContent("1 / 2");
      expect(screen.getByTestId("usage-manage-users")).toHaveAttribute("href", "/settings/members");
    });

    /** @scenario "Free explains Lite members instead of counting zero of zero" */
    it("says Lite members come with Growth rather than counting 0 / 0", () => {
      renderPage();

      const lite = screen.getByTestId("usage-lite-members");
      expect(lite).toHaveTextContent(
        "Lite members come with Growth, read only, free and unlimited.",
      );
      expect(lite).not.toHaveTextContent("0 / 0");
    });
  });

  describe("given an events-metered organization with spans, logs and metrics", () => {
    const byCategory: UsageMonthBreakdown["byCategory"] = [
      { category: "spans", count: 21_400 },
      { category: "logs", count: 6_300 },
      { category: "metrics", count: 2_900 },
      { category: "evaluations", count: 1_100 },
      { category: "experiments", count: 100 },
      { category: "scenarios", count: 0 },
    ];

    /** @scenario "The month's events are split by type" */
    it("lists every type in order with its count, metrics explained", () => {
      given({ plan: FREE_PLAN, count: 31_800, breakdown: { ...month({}), byCategory } });
      renderPage();

      const card = screen.getByTestId("usage-types-card");
      expect(within(card).getByText("By type")).toBeInTheDocument();
      expect(screen.getAllByTestId("usage-type-row").map((row) => row.textContent)).toEqual([
        "Spans21,400",
        "Logs6,300",
        "Metrics1 per series per hour2,900",
        "Evaluations1,100",
        "Experiments100",
        "Scenarios0",
      ]);
      expect(screen.queryByTestId("usage-breakdown-unavailable")).not.toBeInTheDocument();
    });

    /** @scenario "The page says when the split by type cannot be read" */
    it("says the split by type could not be loaded and keeps the day and project breakdowns", () => {
      given({
        plan: FREE_PLAN,
        count: 31_800,
        breakdown: {
          ...month({ "2026-11-01": 3_100 }),
          byCategory: null,
          isByCategoryUnavailable: true,
        },
      });
      renderPage();

      expect(screen.getByTestId("usage-breakdown-unavailable")).toHaveTextContent(
        "The month by type could not be loaded.",
      );
      expect(screen.queryByTestId("usage-types-card")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("daily-bar")).toHaveLength(30);
      expect(screen.getAllByTestId("usage-project-row")).toHaveLength(3);
    });
  });

  describe("given a member who does not administer the organization", () => {
    beforeEach(() => {
      given({ plan: FREE_PLAN, count: 31_800 });
      state.isAdmin = false;
    });

    /** @scenario "A member who does not administer the organization sees the month without the breakdown" */
    it("shows the month's count and meter, with no daily bars and no project list", () => {
      renderPage();

      expect(screen.getByTestId("usage-events-count")).toHaveTextContent("31,800");
      expect(screen.getByTestId("usage-events-meter")).toBeInTheDocument();
      expect(screen.queryAllByTestId("daily-bar")).toHaveLength(0);
      expect(screen.queryByTestId("usage-projects-card")).not.toBeInTheDocument();
      expect(screen.queryByTestId("usage-events-unavailable")).not.toBeInTheDocument();
    });
  });

  describe("given a Free organization with no events this month", () => {
    beforeEach(() =>
      given({ plan: FREE_PLAN, count: 0, breakdown: { ...month({}), projects: [] } }),
    );

    /** @scenario "A new organization with no events is pointed at tracing setup" */
    it("points at tracing setup and lists no projects", () => {
      renderPage();

      const empty = screen.getByTestId("usage-events-empty");
      expect(empty).toHaveTextContent("No events yet this month.");
      expect(empty).toHaveTextContent("Send your first trace and it shows up here.");
      expect(within(empty).getByRole("link", { name: /Set up tracing/ })).toBeInTheDocument();
      expect(screen.getByText("0 of 50,000 included")).toBeInTheDocument();
      expect(screen.queryByTestId("usage-projects-card")).not.toBeInTheDocument();
    });
  });

  describe("given the usage store cannot answer", () => {
    beforeEach(() => given({ plan: FREE_PLAN, count: null }));

    /** @scenario "The page says when the month's events cannot be read" */
    it("says the count could not be loaded instead of claiming an empty month", () => {
      renderPage();

      expect(screen.getByTestId("usage-events-unavailable")).toBeInTheDocument();
      expect(screen.queryByTestId("usage-events-empty")).not.toBeInTheDocument();
    });

    it("says the month by day and by project could not be loaded when that read fails", () => {
      given({ plan: FREE_PLAN, count: 31_800 });
      state.breakdownError = true;
      renderPage();

      expect(screen.getByTestId("usage-breakdown-unavailable")).toHaveTextContent(
        "The month by day and by project could not be loaded.",
      );
      expect(screen.getByTestId("usage-events-count")).toHaveTextContent("31,800");
    });

    it("says so when only the daily read failed", () => {
      given({
        plan: FREE_PLAN,
        count: 31_800,
        breakdown: { ...month({}), days: null, isDailyUnavailable: true },
      });
      renderPage();

      expect(screen.getByTestId("usage-breakdown-unavailable")).toHaveTextContent(
        "The month by day could not be loaded.",
      );
      expect(screen.getAllByTestId("usage-project-row")).toHaveLength(3);
    });

    it("names only the project list when that half failed", () => {
      given({ plan: FREE_PLAN, count: 31_800, breakdown: { ...month({}), projects: null } });
      renderPage();

      expect(screen.getByTestId("usage-breakdown-unavailable")).toHaveTextContent(
        "The month by project could not be loaded.",
      );
      expect(screen.queryByTestId("usage-project-row")).not.toBeInTheDocument();
    });

    it("says the same when the usage read fails outright", () => {
      state.usageError = true;
      renderPage();

      expect(screen.getByTestId("usage-events-unavailable")).toBeInTheDocument();
    });
  });

  describe("given a Growth organization with 3 full seats", () => {
    beforeEach(() => given({ plan: GROWTH_PLAN, count: 31_800, members: 3, lite: 4 }));

    /** @scenario "A Growth organization sees its price and manages its subscription" */
    it("shows the monthly price for its seats and manages the subscription", () => {
      renderPage();

      expect(within(screen.getByTestId("usage-plan-strip")).getByText("Growth plan")).toBeVisible();
      expect(screen.getByTestId("usage-plan-summary")).toHaveTextContent(
        "€87/mo excl. VAT · 3 full seats",
      );
      expect(screen.getByTestId("usage-manage-button")).toHaveAttribute(
        "href",
        "/settings/subscription",
      );
      expect(screen.queryByTestId("usage-upgrade-button")).not.toBeInTheDocument();
    });

    /** @scenario "A Growth organization sees the overage price instead of a meter" */
    it("says what Growth includes and what more costs, with no meter", () => {
      renderPage();

      expect(screen.getByText("200,000 included, then €5 per 100,000")).toBeInTheDocument();
      expect(screen.queryByTestId("usage-events-meter")).not.toBeInTheDocument();
    });

    it("counts the Lite members, unlimited", () => {
      renderPage();

      expect(screen.getByTestId("usage-lite-members")).toHaveTextContent("4unlimited");
    });
  });

  describe("given a legacy tiered paid plan", () => {
    beforeEach(() =>
      given({
        plan: TIERED_PLAN,
        count: 1_000,
        pricingModel: "TIERED",
        usageUnit: "traces",
        breakdown: { ...month({}), days: null },
      }),
    );

    it("counts traces, the unit the plan is metered in", () => {
      renderPage();

      expect(
        within(screen.getByTestId("usage-events-card")).getByText("Traces this month"),
      ).toBeInTheDocument();
      expect(screen.queryAllByTestId("daily-bar")).toHaveLength(0);
      expect(screen.queryByTestId("usage-breakdown-unavailable")).not.toBeInTheDocument();
    });

    /** @scenario "A trace-metered organization sees no split by type" */
    it("shows no split by type and no unavailable note", () => {
      renderPage();

      expect(screen.queryByTestId("usage-types-card")).not.toBeInTheDocument();
      expect(screen.queryByTestId("usage-breakdown-unavailable")).not.toBeInTheDocument();
    });

    it("says no traces yet when the month is empty", () => {
      given({
        plan: TIERED_PLAN,
        count: 0,
        pricingModel: "TIERED",
        usageUnit: "traces",
        breakdown: { ...month({}), days: null },
      });
      renderPage();

      expect(screen.getByTestId("usage-events-empty")).toHaveTextContent(
        "No traces yet this month.",
      );
    });

    /** @scenario "A plan without Lite seats shows no Lite row" */
    it("shows no Lite members row", () => {
      renderPage();

      expect(screen.getByTestId("usage-seats-card")).toBeInTheDocument();
      expect(screen.queryByTestId("usage-lite-members")).not.toBeInTheDocument();
    });
  });
});
