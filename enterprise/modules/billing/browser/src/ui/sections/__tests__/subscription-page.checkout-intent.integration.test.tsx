/**
 * @vitest-environment jsdom
 * SubscriptionPage when the plans page asks it to start the Growth checkout.
 * @see specs/licensing/subscription-page.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { StripeEnvironment } from "@langwatch/enterprise-billing-contract";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BillingFailureNotice,
  type BillingHostOrganization,
  BillingHostApi,
  BillingHostProvider,
  type BillingSuccessNotice,
} from "../../../model/billing-host.ts";
import { checkoutIntentHref } from "../../../model/checkout-intent.ts";
import { SubscriptionPage } from "../subscription-page.tsx";
import {
  createMockPlan,
  mockCreateSubscription,
  mockGetActivePlan,
  mockGetUsage,
  mockOrganization,
  resetMocks,
} from "./subscription-test-setup.ts";

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_intent";

class TestBillingHost extends BillingHostApi {
  readonly failures: BillingFailureNotice[] = [];
  readonly replacements: string[] = [];
  readonly departures: string[] = [];
  private query: Record<string, string | undefined>;

  constructor(query: Record<string, string | undefined>) {
    super();
    this.query = query;
  }

  organization(): BillingHostOrganization | undefined {
    return { id: mockOrganization.id, name: mockOrganization.name, pricingModel: null };
  }

  activeTeamId(): string | undefined {
    return "test-team-id";
  }

  canInviteMembers(): boolean {
    return true;
  }

  routeQuery(): Readonly<Record<string, string | undefined>> {
    return this.query;
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

  replace(to: string): void {
    this.replacements.push(to);
    this.query = {};
  }

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

/** Opens the page at the address the plans page "Upgrade now" links to. */
function arriveFromPlansPage({
  interval,
  currency,
}: {
  interval: "monthly" | "annual";
  currency: "EUR" | "USD";
}) {
  const href = checkoutIntentHref({ interval, currency });
  const query = Object.fromEntries(new URL(href, "http://localhost").searchParams);
  const host = new TestBillingHost(query);
  render(<SubscriptionPage />, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <DesignSystemProvider forcedTheme="light">
        <BillingHostProvider value={host}>{children}</BillingHostProvider>
      </DesignSystemProvider>
    ),
  });
  return host;
}

function checkoutAnswering(result: Promise<{ url: string | null }>) {
  const mutateAsync = vi.fn(() => result);
  mockCreateSubscription.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync,
    isLoading: false,
    isPending: false,
  });
  return mutateAsync;
}

// vi.mock declarations (hoisted)
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

describe("<SubscriptionPage/> opened from the plans page Upgrade now", () => {
  beforeEach(() => {
    resetMocks();
    mockGetUsage.mockReturnValue({
      data: { seatLimitInfo: { status: "ok", message: "" }, membersCount: 2 },
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => cleanup());

  describe("given a Free organization with 2 members", () => {
    /** @scenario "The plans page upgrade opens the Growth checkout" */
    it("creates the annual USD Growth checkout for 2 seats and leaves for Stripe", async () => {
      const createCheckout = checkoutAnswering(Promise.resolve({ url: CHECKOUT_URL }));

      const host = arriveFromPlansPage({ interval: "annual", currency: "USD" });

      await waitFor(() => expect(host.departures).toEqual([CHECKOUT_URL]));
      expect(createCheckout).toHaveBeenCalledTimes(1);
      expect(createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: "GROWTH_SEAT_USD_ANNUAL",
          membersToAdd: 2,
          currency: "USD",
          billingInterval: "annual",
        }),
      );
      expect(host.replacements).toEqual(["/settings/subscription"]);
    });

    /** @scenario "A refused checkout tells the reader why and stays on the page" */
    it("reports the refusal and does not leave the page", async () => {
      const refusal = new Error("organization:manage");
      checkoutAnswering(Promise.reject(refusal));

      const host = arriveFromPlansPage({ interval: "monthly", currency: "EUR" });

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]).toMatchObject({
        error: refusal,
        fallbackTitle: "Couldn't upgrade your plan",
      });
      expect(host.departures).toEqual([]);
      expect(screen.getByTestId("upgrade-plan-block")).toBeInTheDocument();
    });
  });

  describe("given an organization already on Growth", () => {
    /** @scenario "A checkout request is dropped when the organization cannot buy Growth here" */
    it("creates no checkout and clears the request from the address", async () => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          planSource: "subscription",
          type: "GROWTH_SEAT_EUR_MONTHLY",
          name: "Growth",
          free: false,
          maxMembers: 5,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
      const createCheckout = checkoutAnswering(Promise.resolve({ url: CHECKOUT_URL }));

      const host = arriveFromPlansPage({ interval: "monthly", currency: "EUR" });

      await waitFor(() => expect(host.replacements).toEqual(["/settings/subscription"]));
      expect(createCheckout).not.toHaveBeenCalled();
      expect(host.departures).toEqual([]);
    });
  });
});
