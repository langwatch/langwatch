/**
 * @vitest-environment jsdom
 * Every plan, size, viewer and load state that can buy Growth reaches checkout
 * from every upgrade button. @see specs/licensing/subscription-page.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { StripeEnvironment } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  mockCreateSubscription,
  mockDetectCurrency,
  mockGetActivePlan,
  mockGetOrganizationWithMembers,
  mockGetUsage,
  mockManageSubscription,
  mockOrganization,
  mockOrganizationMembers,
  mockUpgradeWithInvites,
  resetMocks,
  setMockOrganization,
} from "./subscription-test-setup.ts";

class TestBillingHost extends BillingHostApi {
  readonly failures: BillingFailureNotice[] = [];
  readonly departures: string[] = [];

  constructor(private readonly mayInvite: boolean) {
    super();
  }

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

  canInviteMembers(): boolean {
    return this.mayInvite;
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

  navigate(): void {}

  replace(): void {}

  leaveTo(url: string): void {
    this.departures.push(url);
  }

  applicationOrigin(): string {
    return "http://localhost";
  }

  succeeded(_notice: BillingSuccessNotice): void {}

  failed(failure: BillingFailureNotice): void {
    this.failures.push(failure);
  }
}

const renderSubscriptionPage = ({ mayInvite }: { mayInvite: boolean }) => {
  const host = new TestBillingHost(mayInvite);
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <DesignSystemProvider forcedTheme="light">
      <BillingHostProvider value={host}>{children}</BillingHostProvider>
    </DesignSystemProvider>
  );
  render(<SubscriptionPage />, { wrapper: Wrapper });
  return host;
};

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
      limits: { getUsage: { useQuery: () => setup.mockGetUsage() } },
      plan: { getActivePlan: { useQuery: () => setup.mockGetActivePlan() } },
      organization: {
        getOrganizationWithMembersAndTheirTeams: {
          useQuery: () => setup.mockGetOrganizationWithMembers(),
        },
      },
      invite: {
        upgradeWithInvites: { useMutation: () => setup.mockUpgradeWithInvites() },
        getOrganizationPendingInvites: {
          useQuery: () => ({ ...setup.mockGetPendingInvites(), refetch: vi.fn() }),
        },
        createInvites: { useMutation: () => setup.mockCreateInvites() },
      },
      currency: {
        detectCurrency: {
          useQuery: (_input: Record<string, never>, opts: { enabled: boolean }) =>
            opts.enabled ? setup.mockDetectCurrency() : { data: undefined },
        },
      },
      subscription: {
        updateUsers: { useMutation: () => setup.mockUpdateUsers() },
        create: { useMutation: () => setup.mockCreateSubscription() },
        addTeamMemberOrEvents: { useMutation: () => setup.mockAddTeamMemberOrEvents() },
        manage: { useMutation: () => setup.mockManageSubscription() },
        listInvoices: { useQuery: () => setup.mockListInvoices() },
        getLastSubscription: { useQuery: () => setup.mockGetLastSubscription() },
        developerSeats: {
          useQuery: (_input: unknown, opts: { enabled: boolean }) => ({
            ...(opts.enabled ? setup.mockDeveloperSeats() : { data: undefined }),
            refetch: setup.mockDeveloperSeatsRefetch,
          }),
        },
        previewDeveloperSeats: {
          useQuery: (input: { quantity: number }, opts: { enabled: boolean }) =>
            opts.enabled
              ? setup.mockPreviewDeveloperSeats(input)
              : { data: undefined, isLoading: false, isError: false },
        },
        setDeveloperSeats: {
          useMutation: () => ({ mutateAsync: setup.mockSetDeveloperSeats, isPending: false }),
        },
        previewProration: {
          useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
        },
      },
      useUtils: vi.fn(() => ({
        organization: { getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() } },
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// The dimensions
// ---------------------------------------------------------------------------

type PlanCase = {
  name: string;
  pricingModel: string;
  plan: Parameters<typeof createMockPlan>[0];
};

/** Every plan an organization can hold and still buy Growth from this page. */
const PLANS_THAT_CAN_BUY_GROWTH: PlanCase[] = [
  { name: "the Free plan", pricingModel: "SEAT_EVENT", plan: {} },
  { name: "the Free plan on legacy pricing", pricingModel: "TIERED", plan: {} },
  {
    name: "a legacy tiered paid plan",
    pricingModel: "TIERED",
    plan: { type: "ACCELERATE", name: "Accelerate", free: false, maxMembers: 5 },
  },
  {
    name: "a license below Enterprise",
    pricingModel: "TIERED",
    plan: { planSource: "license", type: "PRO", name: "Pro", free: false, maxMembers: 10 },
  },
];

/** Members relative to the plan's seats: below, at and above them. */
const SIZES = [
  { name: "below", membersRelativeToSeats: -1 },
  { name: "at", membersRelativeToSeats: 0 },
  { name: "above", membersRelativeToSeats: 1 },
] as const;

const VIEWERS = [
  { name: "may", mayInvite: true },
  { name: "may not", mayInvite: false },
] as const;

const CURRENCIES = ["EUR", "USD"] as const;

const USAGE_STATES = [
  { name: "been read", loaded: true },
  { name: "not loaded yet", loaded: false },
] as const;

const cases = PLANS_THAT_CAN_BUY_GROWTH.flatMap((plan) =>
  SIZES.flatMap((size) =>
    VIEWERS.flatMap((viewer) =>
      CURRENCIES.flatMap((currency) =>
        USAGE_STATES.map((usage) => ({ plan, size, viewer, currency, usage })),
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// Givens
// ---------------------------------------------------------------------------

const member = (index: number) => ({
  userId: `user-${index}`,
  role: index === 0 ? "ADMIN" : "MEMBER",
  user: {
    id: `user-${index}`,
    name: `User ${index}`,
    email: `user-${index}@example.com`,
    teamMemberships: [],
  },
});

const givenPlan = ({ pricingModel, plan }: { pricingModel: string; plan: PlanCase["plan"] }) => {
  setMockOrganization({ id: "test-org-id", name: "Test Org", pricingModel });
  mockGetActivePlan.mockReturnValue({
    data: createMockPlan(plan),
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenMembers = ({
  count,
  seats,
  loaded,
}: {
  count: number;
  seats: number;
  loaded: boolean;
}) => {
  mockGetOrganizationWithMembers.mockReturnValue({
    data: {
      ...mockOrganizationMembers,
      members: Array.from({ length: count }, (_, index) => member(index)),
    },
    isLoading: false,
    refetch: vi.fn(),
  });
  mockGetUsage.mockReturnValue(
    loaded
      ? {
          data: {
            seatLimitInfo:
              count > seats
                ? {
                    status: "exceeded",
                    message: `Your organization uses ${count} member seats and your plan includes ${seats} member seats.`,
                  }
                : { status: "ok", message: "" },
            membersCount: count,
          },
          isLoading: false,
          refetch: vi.fn(),
        }
      : { data: undefined, isLoading: true, refetch: vi.fn() },
  );
};

const givenCurrency = (currency: "EUR" | "USD") => {
  mockDetectCurrency.mockReturnValue({ data: { currency }, isLoading: false });
};

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/test";

const recordCheckouts = () => {
  const create = vi.fn().mockResolvedValue({ url: CHECKOUT_URL });
  const withInvites = vi.fn().mockResolvedValue({ url: CHECKOUT_URL });
  mockCreateSubscription.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: create,
    isLoading: false,
    isPending: false,
  });
  mockUpgradeWithInvites.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: withInvites,
    isLoading: false,
    isPending: false,
  });
  return { create, withInvites };
};

const CONTINUE = "Continue to checkout";
const UPGRADE_BUTTON = /^(Upgrade now|Upgrade to Growth)$/i;

describe("<SubscriptionPage/> upgrade path for every organization that can pay", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  /** @scenario "An organization that can buy Growth is offered an upgrade that reaches checkout" */
  it.each(cases)(
    "when on $plan.name with members $size.name its seats, a viewer who $viewer.name invite, paying in $currency, usage $usage.name: every upgrade button starts a Growth checkout",
    async ({ plan, size, viewer, currency, usage }) => {
      const seats = createMockPlan(plan.plan).maxMembers;
      const memberCount = Math.max(1, seats + size.membersRelativeToSeats);
      givenPlan(plan);
      givenMembers({ count: memberCount, seats, loaded: usage.loaded });
      givenCurrency(currency);
      const { create, withInvites } = recordCheckouts();

      const host = renderSubscriptionPage({ mayInvite: viewer.mayInvite });

      const buttons = await screen.findAllByRole("button", { name: UPGRADE_BUTTON });
      expect(buttons.length).toBeGreaterThan(0);

      for (const [index, button] of buttons.entries()) {
        expect(button).toBeEnabled();
        fireEvent.click(button);
        // An upgrade may open the seat dialog first; its default seat count goes to checkout.
        await waitFor(() => {
          const reached = host.departures.length > index;
          expect(reached || screen.queryByRole("button", { name: CONTINUE }) !== null).toBe(true);
        });
        if (host.departures.length === index) {
          fireEvent.click(screen.getByRole("button", { name: CONTINUE }));
        }
        await waitFor(() => {
          expect(host.departures).toHaveLength(index + 1);
        });
        expect(host.departures[index]).toBe(CHECKOUT_URL);
        expect(create).toHaveBeenCalledTimes(index + 1);
        expect(create).toHaveBeenLastCalledWith(
          expect.objectContaining({
            organizationId: "test-org-id",
            plan: `GROWTH_SEAT_${currency}_MONTHLY`,
            currency,
            membersToAdd: expect.any(Number),
          }),
        );
        const { membersToAdd } = create.mock.lastCall![0] as { membersToAdd: number };
        expect(membersToAdd).toBeGreaterThanOrEqual(memberCount);
      }
      expect(withInvites).not.toHaveBeenCalled();
      expect(host.failures).toEqual([]);
    },
  );

  describe("when the organization is on the Growth plan", () => {
    beforeEach(() => {
      givenPlan({
        pricingModel: "SEAT_EVENT",
        plan: {
          planSource: "subscription",
          type: "GROWTH_SEAT_EUR_MONTHLY",
          name: "Growth",
          free: false,
          maxMembers: 3,
        },
      });
      givenMembers({ count: 2, seats: 3, loaded: true });
    });

    /** @scenario "A Growth organization manages its subscription instead of buying it again" */
    it("offers the billing portal and no second checkout", async () => {
      const { create } = recordCheckouts();
      const manage = vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/session/test" });
      mockManageSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync: manage,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage({ mayInvite: true });

      const manageButton = await screen.findByRole("button", { name: "Manage subscription" });
      expect(screen.queryByRole("button", { name: UPGRADE_BUTTON })).toBeNull();

      fireEvent.click(manageButton);
      await waitFor(() => {
        expect(manage).toHaveBeenCalled();
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe.each([
    { name: "a subscription", planSource: "subscription" as const },
    { name: "a license", planSource: "license" as const },
  ])("when the organization holds Enterprise through $name", ({ planSource }) => {
    beforeEach(() => {
      givenPlan({
        pricingModel: "TIERED",
        plan: { planSource, type: "ENTERPRISE", name: "Enterprise", free: false, maxMembers: 100 },
      });
      givenMembers({ count: 2, seats: 100, loaded: true });
    });

    /** @scenario "An Enterprise organization is never sent to checkout" */
    it("offers no upgrade and starts no checkout", async () => {
      const { create, withInvites } = recordCheckouts();
      renderSubscriptionPage({ mayInvite: true });

      await screen.findByTestId("current-plan-block");
      expect(screen.queryByRole("button", { name: UPGRADE_BUTTON })).toBeNull();
      expect(screen.queryByTestId("upgrade-plan-block")).toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(withInvites).not.toHaveBeenCalled();
    });
  });
});
