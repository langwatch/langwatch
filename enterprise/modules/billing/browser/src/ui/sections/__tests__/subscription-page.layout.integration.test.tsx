/**
 * @vitest-environment jsdom
 * SubscriptionPage layout: the plan card's action and usage, the block order,
 * and invoices last. @see specs/licensing/subscription-page.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { StripeEnvironment } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BillingFailureNotice,
  type BillingHostOrganization,
  BillingHostApi,
  BillingHostProvider,
  type BillingSuccessNotice,
} from "../../../model/billing-host.ts";
import { SubscriptionPage } from "../subscription-page.tsx";
import {
  createMockPlan,
  type MockMessageLimitInfo,
  mockCreateSubscription,
  mockGetActivePlan,
  mockGetOrganizationWithMembers,
  mockGetUsage,
  mockListInvoices,
  mockOrganization,
  mockOrganizationMembers,
  resetMocks,
  setMockOrganization,
} from "./subscription-test-setup.ts";

class TestBillingHost extends BillingHostApi {
  readonly successes: BillingSuccessNotice[] = [];
  readonly failures: BillingFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly departures: string[] = [];

  organization(): BillingHostOrganization | undefined {
    return {
      id: mockOrganization.id,
      name: mockOrganization.name,
      pricingModel: (mockOrganization.pricingModel ??
        null) as BillingHostOrganization["pricingModel"],
    };
  }

  activeTeamId(): string | undefined {
    return "test-team-id";
  }

  routeQuery(): Readonly<Record<string, string | undefined>> {
    return {};
  }

  isSaaS(): boolean {
    return true;
  }

  stripeEnvironment(): StripeEnvironment {
    return "test";
  }

  isDeploymentSettled(): boolean {
    return true;
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  replace(to: string): void {
    this.navigations.push(to);
  }

  leaveTo(url: string): void {
    this.departures.push(url);
  }

  applicationOrigin(): string {
    return "http://localhost";
  }

  succeeded(notice: BillingSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: BillingFailureNotice): void {
    this.failures.push(failure);
  }
}

const renderSubscriptionPage = () => {
  const host = new TestBillingHost();
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <DesignSystemProvider forcedTheme="light">
      <BillingHostProvider value={host}>{children}</BillingHostProvider>
    </DesignSystemProvider>
  );
  return render(<SubscriptionPage />, { wrapper: Wrapper });
};

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted — must be at module top-level)
// ---------------------------------------------------------------------------
vi.mock("@langwatch/browser-host/lent", async (importOriginal) => {
  const setup = await import("./subscription-test-setup.ts");
  return {
    ...(await importOriginal<object>()),
    useLentHooks: () => ({ openSeats: setup.mockOpenSeats }),
  };
});

vi.mock("../../../behavior/billing-api.ts", async () => {
  const setup = await import("./subscription-test-setup.ts");
  return {
    billingApi: {
      limits: {
        getUsage: {
          useQuery: () => setup.mockGetUsage(),
        },
      },
      plan: {
        getActivePlan: {
          useQuery: () => setup.mockGetActivePlan(),
        },
      },
      organization: {
        getOrganizationWithMembersAndTheirTeams: {
          useQuery: () => setup.mockGetOrganizationWithMembers(),
        },
      },
      invite: {
        upgradeWithInvites: {
          useMutation: () => setup.mockUpgradeWithInvites(),
        },
        getOrganizationPendingInvites: {
          useQuery: () => ({
            ...setup.mockGetPendingInvites(),
            refetch: vi.fn(),
          }),
        },
        createInvites: {
          useMutation: () => setup.mockCreateInvites(),
        },
      },
      currency: {
        detectCurrency: {
          useQuery: (_input: Record<string, never>, opts: { enabled: boolean }) =>
            opts.enabled ? setup.mockDetectCurrency() : { data: undefined },
        },
      },
      subscription: {
        updateUsers: {
          useMutation: () => setup.mockUpdateUsers(),
        },
        create: {
          useMutation: () => setup.mockCreateSubscription(),
        },
        addTeamMemberOrEvents: {
          useMutation: () => setup.mockAddTeamMemberOrEvents(),
        },
        manage: {
          useMutation: () => setup.mockManageSubscription(),
        },
        listInvoices: {
          useQuery: () => setup.mockListInvoices(),
        },
        getLastSubscription: {
          useQuery: () => setup.mockGetLastSubscription(),
        },
      },
      useUtils: vi.fn(() => ({
        organization: {
          getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() },
        },
      })),
    },
  };
});

const eventLimit = (overrides: Partial<MockMessageLimitInfo>): MockMessageLimitInfo => ({
  status: "ok",
  current: 0,
  max: 50000,
  currentFormatted: "0",
  maxFormatted: "50,000",
  percentageFormatted: "0%",
  message: "",
  ...overrides,
});

const givenUsage = ({
  membersCount,
  messageLimitInfo,
}: {
  membersCount: number;
  messageLimitInfo?: MockMessageLimitInfo;
}) => {
  mockGetUsage.mockReturnValue({
    data: {
      seatLimitInfo: { status: "ok", message: "" },
      membersCount,
      currentMonthMessagesCount: messageLimitInfo?.current,
      messageLimitInfo,
      usageUnit: "events",
    },
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenOneMember = () => {
  mockGetOrganizationWithMembers.mockReturnValue({
    data: { ...mockOrganizationMembers, members: [mockOrganizationMembers.members[0]!] },
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenGrowthSubscription = () => {
  setMockOrganization({
    id: "test-org-id",
    name: "Test Org",
    currency: "EUR",
    pricingModel: "SEAT_EVENT",
  });
  mockGetActivePlan.mockReturnValue({
    data: createMockPlan({
      planSource: "subscription",
      type: "GROWTH_SEAT_EUR_MONTHLY",
      name: "Growth",
      free: false,
      maxMembers: 2,
      maxMessagesPerMonth: 200000,
    }),
    isLoading: false,
    refetch: vi.fn(),
  });
};

const paidInvoice = {
  id: "in_1",
  number: "INV-0001",
  date: 1_760_000_000,
  amountDue: 2900,
  currency: "eur",
  status: "paid",
  pdfUrl: "https://example.com/in_1.pdf",
  hostedUrl: null,
};

/** The page's top-level blocks, in the order they render. */
const blockOrder = () =>
  Array.from(
    document.querySelectorAll(
      '[data-testid="current-plan-block"], [data-testid="upgrade-plan-block"], [data-testid="contact-sales-block"], [data-testid="invoices-block"]',
    ),
  ).map((element) => element.getAttribute("data-testid"));

describe("<SubscriptionPage/> layout", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the organization is on the Free plan with one member", () => {
    beforeEach(() => {
      givenOneMember();
      givenUsage({ membersCount: 1, messageLimitInfo: eventLimit({}) });
    });

    /** @scenario "A Free plan's card carries the Growth upgrade as its action" */
    it("starts the Growth checkout for one seat from the plan card", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      const card = await screen.findByTestId("current-plan-block");
      fireEvent.click(within(card).getByRole("button", { name: "Upgrade to Growth" }));

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ membersToAdd: 1 }));
      });
    });

    /** @scenario "The plan card holds the page's one primary upgrade button" */
    it("keeps the Growth offer's button secondary and starting the same checkout", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      const card = await screen.findByTestId("current-plan-block");
      const cardButton = within(card).getByRole("button", { name: "Upgrade to Growth" });
      const offerButton = within(screen.getByTestId("upgrade-plan-block")).getByRole("button", {
        name: /Upgrade now/i,
      });
      expect(cardButton).toHaveAttribute("data-emphasis", "primary");
      expect(offerButton).toHaveAttribute("data-emphasis", "secondary");

      fireEvent.click(offerButton);
      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ membersToAdd: 1 }));
      });
    });

    /** @scenario "A Free organization with no invoices sees no invoices block" */
    it("shows no invoices block", async () => {
      renderSubscriptionPage();

      await screen.findByTestId("current-plan-block");
      expect(screen.queryByTestId("invoices-block")).toBeNull();
    });
  });

  describe("when a Free organization has invoices from an earlier subscription", () => {
    beforeEach(() => {
      givenOneMember();
      givenUsage({ membersCount: 1, messageLimitInfo: eventLimit({}) });
      mockListInvoices.mockReturnValue({ data: [paidInvoice], isLoading: false, isError: false });
    });

    /** @scenario "The Growth offer comes right after the current plan and invoices come last" */
    it("puts the Growth offer after the plan card and the invoices last", async () => {
      renderSubscriptionPage();

      await screen.findByTestId("invoices-block");
      expect(blockOrder()).toEqual([
        "current-plan-block",
        "upgrade-plan-block",
        "contact-sales-block",
        "invoices-block",
      ]);
    });
  });

  describe("when a Free organization sent 12,000 of its 50,000 events", () => {
    beforeEach(() => {
      givenUsage({
        membersCount: 2,
        messageLimitInfo: eventLimit({ current: 12000, currentFormatted: "12,000" }),
      });
    });

    /** @scenario "The current plan shows this month's events against the plan's limit" */
    it("shows the events against the limit with a meter", async () => {
      renderSubscriptionPage();

      const row = await screen.findByTestId("plan-event-usage");
      expect(row).toHaveTextContent("Events this month");
      expect(row).toHaveTextContent("12,000 / 50,000");
      expect(within(row).getByTestId("plan-event-meter").firstElementChild).toHaveAttribute(
        "data-fill-ratio",
        "0.24",
      );
    });
  });

  describe("when this month's event count could not be read", () => {
    beforeEach(() => {
      mockGetUsage.mockReturnValue({
        data: {
          seatLimitInfo: { status: "ok", message: "" },
          membersCount: 2,
          currentMonthMessagesCount: null,
          messageLimitInfo: eventLimit({}),
          usageUnit: "events",
        },
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    /** @scenario "The plan card shows no event figure while the count is unavailable" */
    it("shows no event count rather than zero", async () => {
      renderSubscriptionPage();

      await screen.findByTestId("current-plan-block");
      expect(screen.queryByTestId("plan-event-usage")).toBeNull();
    });
  });

  describe("when a Free organization used all of its events", () => {
    beforeEach(() => {
      givenUsage({
        membersCount: 2,
        messageLimitInfo: eventLimit({
          status: "exceeded",
          current: 50000,
          currentFormatted: "50,000",
        }),
      });
    });

    /** @scenario "A Free plan at its event limit says the limit is reached" */
    it("says the limit is reached and offers the upgrade", async () => {
      renderSubscriptionPage();

      const row = await screen.findByTestId("plan-event-usage");
      expect(row).toHaveTextContent("Limit reached");
      expect(screen.getByTestId("upgrade-plan-block")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("current-plan-block")).getByRole("button", {
          name: "Upgrade to Growth",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("when the organization has an active Growth subscription", () => {
    beforeEach(() => {
      givenGrowthSubscription();
      givenUsage({
        membersCount: 2,
        messageLimitInfo: eventLimit({
          current: 340000,
          currentFormatted: "340,000",
          max: 200000,
          maxFormatted: "200,000",
          status: "exceeded",
        }),
      });
    });

    /** @scenario "A paid plan's card carries subscription management as its action" */
    it("offers subscription management and no upgrade on the plan card", async () => {
      renderSubscriptionPage();

      const card = await screen.findByTestId("current-plan-block");
      expect(within(card).getByRole("button", { name: "Manage subscription" })).toBeInTheDocument();
      expect(within(card).queryByRole("button", { name: "Upgrade to Growth" })).toBeNull();
      expect(screen.queryByTestId("upgrade-plan-block")).toBeNull();
    });

    /** @scenario "A plan billed per event shows the month's events without a limit" */
    it("shows the events sent without a limit or meter", async () => {
      renderSubscriptionPage();

      const row = await screen.findByTestId("plan-event-usage");
      expect(row).toHaveTextContent("340,000");
      expect(row).not.toHaveTextContent("200,000");
      expect(row).not.toHaveTextContent("Limit reached");
      expect(within(row).queryByTestId("plan-event-meter")).toBeNull();
    });

    /** @scenario "A paid plan with no invoices yet sees a one-line note" */
    it("says on one line that there are no invoices yet", async () => {
      renderSubscriptionPage();

      const invoices = await screen.findByTestId("invoices-block");
      expect(within(invoices).getByTestId("invoices-empty")).toHaveAttribute("data-size", "line");
      expect(invoices).toHaveTextContent("No invoices yet");
    });
  });
});
