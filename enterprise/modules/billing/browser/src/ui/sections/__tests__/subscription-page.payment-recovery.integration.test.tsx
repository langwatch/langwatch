/**
 * @vitest-environment jsdom
 * SubscriptionPage while a payment recovery case is open: the plan card pays the open
 * invoice instead of starting a new checkout. @see specs/licensing/subscription-page.feature
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
  mockCreateSubscription,
  mockGetActivePlan,
  mockGetOrganizationWithMembers,
  mockGetUsage,
  mockOrganization,
  mockOrganizationMembers,
  resetMocks,
  setMockOrganization,
} from "./subscription-test-setup.ts";

const { reader, payLink, leaveTo, failed } = vi.hoisted(() => ({
  reader: { canPay: true },
  payLink: {
    mutate: (() => undefined) as (
      input: { organizationId: string },
      handlers: { onSuccess: (link: { url: string }) => void; onError: (error: Error) => void },
    ) => void,
  },
  leaveTo: vi.fn(),
  failed: vi.fn(),
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => {
  const services = () => ({
    session: {
      hasOrganizationPermission: (permission: string) =>
        reader.canPay && permission === "subscription:manage",
    },
    feedback: { failed },
  });
  return {
    ...(await importOriginal<object>()),
    useUiHostServices: services,
    useOptionalUiHostServices: services,
  };
});
vi.mock("@langwatch/browser-host/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uiLeaveTo: leaveTo,
}));

class TestBillingHost extends BillingHostApi {
  readonly successes: BillingSuccessNotice[] = [];
  readonly failures: BillingFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly departures: string[] = [];

  constructor(private query: Record<string, string | undefined> = {}) {
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
    return true;
  }

  canReadMonthBreakdown(): boolean {
    return true;
  }

  canReadHeldSeats(): boolean {
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

  navigate(to: string): void {
    this.navigations.push(to);
  }

  replace(to: string): void {
    this.navigations.push(to);
    this.query = {};
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

const renderSubscriptionPage = (host = new TestBillingHost()) => {
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
      dataRetention: {
        getOrganizationStorageEstimate: { useQuery: () => ({ data: undefined, isError: false }) },
        getOrganizationRetention: { useQuery: () => ({ data: undefined, isError: false }) },
      },
      limits: { getUsage: { useQuery: () => setup.mockGetUsage() } },
      plan: { getActivePlan: { useQuery: () => setup.mockGetActivePlan() } },
      organization: {
        getOrganizationWithMembersAndTheirTeams: {
          useQuery: () => setup.mockGetOrganizationWithMembers(),
        },
        listHeldSeats: { useQuery: () => setup.mockListHeldSeats() },
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
        getLastSubscription: {
          useQuery: () => ({ ...setup.mockGetLastSubscription(), refetch: vi.fn() }),
        },
        developerSeats: {
          useQuery: (_input: unknown, opts: { enabled: boolean }) => ({
            ...(opts.enabled ? setup.mockDeveloperSeats() : { data: undefined }),
            refetch: setup.mockDeveloperSeatsRefetch,
          }),
        },
        previewDeveloperSeats: {
          useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
        },
        setDeveloperSeats: {
          useMutation: () => ({ mutateAsync: setup.mockSetDeveloperSeats, isPending: false }),
        },
        previewProration: {
          useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
        },
        paymentRecoveryPayLink: {
          useMutation: () => ({
            isPending: false,
            mutate: (...args: Parameters<typeof payLink.mutate>) => payLink.mutate(...args),
          }),
        },
      },
      useUtils: vi.fn(() => ({
        organization: { getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() } },
      })),
    },
  };
});

const INVOICE_URL = "https://invoice.stripe.test/i/acme";

const givenOneMember = () => {
  mockGetOrganizationWithMembers.mockReturnValue({
    data: { ...mockOrganizationMembers, members: [mockOrganizationMembers.members[0]!] },
    isLoading: false,
    refetch: vi.fn(),
  });
  mockGetUsage.mockReturnValue({
    data: { seatLimitInfo: { status: "ok", message: "" }, membersCount: 1 },
    isLoading: false,
    refetch: vi.fn(),
  });
};

/** Day 21: the plan resolves to Free limits while the invoice stays unpaid. */
const givenPausedOnFree = () => {
  mockGetActivePlan.mockReturnValue({
    data: createMockPlan({ paymentFailed: true }),
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenFailingGrowth = () => {
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
      paymentFailed: true,
      additionsHeldForPayment: true,
    }),
    isLoading: false,
    refetch: vi.fn(),
  });
};

const payLinkAnswers = (url: string) => {
  payLink.mutate = (_input, handlers) => handlers.onSuccess({ url });
};

describe("<SubscriptionPage/> while a payment recovery case is open", () => {
  beforeEach(() => {
    resetMocks();
    reader.canPay = true;
    leaveTo.mockClear();
    failed.mockClear();
    payLinkAnswers(INVOICE_URL);
    givenOneMember();
  });

  afterEach(() => cleanup());

  describe("when the organization was paused onto Free limits", () => {
    beforeEach(() => givenPausedOnFree());

    /** @scenario "A paused organization's plan card offers to pay the open invoice, not an upgrade" */
    it("offers Pay now to the open invoice and no upgrade anywhere", async () => {
      const calls: { organizationId: string }[] = [];
      payLink.mutate = (input, handlers) => {
        calls.push(input);
        handlers.onSuccess({ url: INVOICE_URL });
      };
      renderSubscriptionPage();

      const card = await screen.findByTestId("current-plan-block");
      fireEvent.click(within(card).getByRole("button", { name: "Pay now" }));

      expect(calls).toEqual([{ organizationId: "test-org-id" }]);
      expect(leaveTo).toHaveBeenCalledWith(INVOICE_URL);
      expect(screen.queryByRole("button", { name: "Upgrade to Growth" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Upgrade now" })).toBeNull();
      expect(screen.queryByTestId("upgrade-plan-block")).toBeNull();
      expect(screen.queryByTestId("user-count-link")).toBeNull();
    });

    /** @scenario "A checkout request is dropped while an invoice is unpaid" */
    it("drops a checkout request without opening the seat dialog", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      const host = renderSubscriptionPage(new TestBillingHost({ checkout: "growth" }));

      await waitFor(() => expect(host.navigations).toContain("/settings/subscription"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mutateAsync).not.toHaveBeenCalled();
    });

    /** @scenario "A payment page that cannot be opened says so and stays on the page" */
    it("reports the failed pay link and leaves nowhere", async () => {
      const refused = new Error("stripe unavailable");
      payLink.mutate = (_input, handlers) => handlers.onError(refused);
      renderSubscriptionPage();

      fireEvent.click(await screen.findByRole("button", { name: "Pay now" }));

      expect(failed).toHaveBeenCalledWith({
        error: refused,
        fallbackTitle: "The payment page could not be opened",
      });
      expect(leaveTo).not.toHaveBeenCalled();
      expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
    });

    /** @scenario "A member who cannot pay is offered neither the invoice nor an upgrade" */
    it("shows a member without billing permission no pay or upgrade action", async () => {
      reader.canPay = false;
      renderSubscriptionPage();

      const card = await screen.findByTestId("current-plan-block");
      expect(within(card).queryByRole("button", { name: "Pay now" })).toBeNull();
      expect(within(card).queryByRole("button", { name: "Upgrade to Growth" })).toBeNull();
      expect(within(card).queryByTestId("current-plan-pay-invoice-button")).toBeNull();
    });
  });

  describe("when the paused organization has more members than Free includes", () => {
    beforeEach(() => {
      givenPausedOnFree();
      mockGetUsage.mockReturnValue({
        data: {
          seatLimitInfo: {
            status: "exceeded",
            message: "Your organization uses 3 member seats and your plan includes 2 member seats.",
          },
          membersCount: 3,
        },
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    /** @scenario "A paused organization over its seats is told to pay the invoice, not to add seats" */
    it("says to pay the open invoice and offers no add-seats or upgrade action", async () => {
      renderSubscriptionPage();

      const note = await screen.findByTestId("seat-limit-callout");
      expect(note).toHaveTextContent("Pay the open invoice to get your plan back.");
      expect(within(note).queryByRole("button", { name: "Add seats" })).toBeNull();
      expect(note).not.toHaveTextContent("Upgrade to the Growth plan");
    });
  });

  describe("when a Growth renewal failed and the plan is kept", () => {
    beforeEach(() => givenFailingGrowth());

    /** @scenario "A paid plan with a failed payment offers to update the card" */
    it("offers Update card to the open invoice", async () => {
      renderSubscriptionPage();

      const card = await screen.findByTestId("current-plan-block");
      fireEvent.click(within(card).getByRole("button", { name: "Update card" }));

      expect(leaveTo).toHaveBeenCalledWith(INVOICE_URL);
    });
  });
});
