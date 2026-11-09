/**
 * @vitest-environment jsdom
 * The Manage seats drawer on a Growth plan, and the plan card of a contract or licence.
 * @see specs/licensing/seat-rotation.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { StripeEnvironment } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

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
  mockAddTeamMemberOrEvents,
  mockGetActivePlan,
  mockGetLastSubscription,
  mockCreateInvitesMutateAsync,
  mockGetUsage,
  mockOrganization,
  resetMocks,
  setMockOrganization,
} from "./subscription-test-setup.ts";

const { mockPreviewProration } = vi.hoisted(() => ({ mockPreviewProration: vi.fn() }));

class TestBillingHost extends BillingHostApi {
  canReadMonthBreakdown(): boolean {
    return true;
  }
  canReadHeldSeats(): boolean {
    return true;
  }

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

  canInviteMembers(): boolean {
    return true;
  }

  routeQuery(): Readonly<Record<string, string | undefined>> {
    return {};
  }

  constructor(private readonly saas: boolean) {
    super();
  }

  isSaaS(): boolean {
    return this.saas;
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

const renderSubscriptionPage = ({ saas = true }: { saas?: boolean } = {}) => {
  const host = new TestBillingHost(saas);
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
      dataRetention: {
        getOrganizationStorageEstimate: { useQuery: () => ({ data: undefined, isError: false }) },
      },
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
        listHeldSeats: { useQuery: () => setup.mockListHeldSeats() },
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
          useQuery: () => ({ ...setup.mockGetLastSubscription(), refetch: vi.fn() }),
        },
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
          useQuery: (input: { newTotalSeats: number }, opts: { enabled: boolean }) =>
            opts.enabled
              ? mockPreviewProration(input)
              : { data: undefined, isLoading: false, isError: false },
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

const DEC_1 = Date.UTC(2026, 11, 1);

const lowerQuote = {
  amountDueCents: 0,
  formattedAmountDue: "€0",
  formattedCreditApplied: null,
  formattedRecurringTotal: "€87",
  billingInterval: "month",
  quotedAt: 1_700_000_000,
  appliesAt: DEC_1,
  keptSeats: 5,
  formattedKeptRecurringTotal: "€145",
};

const addQuote = {
  amountDueCents: 1798,
  formattedAmountDue: "€17.98",
  formattedCreditApplied: null,
  formattedRecurringTotal: "€174",
  billingInterval: "month",
  quotedAt: 1_700_000_000,
  appliesAt: null,
  keptSeats: null,
  formattedKeptRecurringTotal: null,
};

const givenPlan = (overrides: Parameters<typeof createMockPlan>[0]) =>
  mockGetActivePlan.mockReturnValue({
    data: createMockPlan(overrides),
    isLoading: false,
    refetch: vi.fn(),
  });

/** The drawer footer's summary of the seat change. */
const seatSummary = () => {
  const found = screen.getAllByTestId("seat-change-summary");
  return within(found[found.length - 1]!);
};

const button = (name: string) => {
  const found = screen.getAllByRole("button", { name });
  return found[found.length - 1]!;
};

describe("<SubscriptionPage/> seat rotation", () => {
  beforeEach(() => {
    resetMocks();
    mockGetUsage.mockReturnValue({
      data: { seatLimitInfo: { status: "ok", message: "" }, membersCount: 2 },
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a Growth plan with 5 seats", () => {
    let mutateAsync: Mock<(input: unknown) => Promise<{ success: boolean }>>;

    beforeEach(() => {
      setMockOrganization({
        id: "test-org-id",
        name: "Test Org",
        currency: "EUR",
        pricingModel: "SEAT_EVENT",
      });
      givenPlan({
        type: "GROWTH_SEAT_EUR_MONTHLY",
        name: "Growth",
        free: false,
        planSource: "subscription",
        maxMembers: 5,
      });
      mutateAsync = vi.fn(async (_input: unknown) => ({ success: true }));
      mockAddTeamMemberOrEvents.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
    });

    /** @scenario "The seat drawer explains a lower count" */
    it("says the seats stay until the period ends and lowers from the next cycle", async () => {
      mockPreviewProration.mockReturnValue({ data: lowerQuote, isLoading: false, isError: false });
      renderSubscriptionPage();

      fireEvent.click(screen.getByTestId("user-count-link"));
      // Two members fill two of the five seats; dropping two empty seats leaves three.
      fireEvent.click(await screen.findByTestId("drawer-seats-stepper-minus"));
      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));

      expect(
        await screen.findByText(
          "You'll keep 5 seats until 1 Dec, then pay for 3. No refund for the rest of this month.",
        ),
      ).toBeInTheDocument();
      expect(seatSummary().getByText("5 \u2192 3")).toBeInTheDocument();
      expect(seatSummary().getByText("From 1 Dec")).toBeInTheDocument();
      expect(seatSummary().getByText("\u20ac87/mo")).toBeInTheDocument();
      expect(seatSummary().getByText("Until 1 Dec")).toBeInTheDocument();
      expect(seatSummary().getByText("\u20ac145/mo")).toBeInTheDocument();
      expect(mockPreviewProration).toHaveBeenLastCalledWith(
        expect.objectContaining({ newTotalSeats: 3 }),
      );

      fireEvent.click(button("Lower to 3 seats"));
      fireEvent.click(
        within(await screen.findByTestId("seat-confirm-dialog")).getByRole("button", {
          name: "Lower to 3 seats",
        }),
      );

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ totalMembers: 3, quotedAt: lowerQuote.quotedAt }),
        ),
      );
    });

    /** @scenario "The seat drawer explains an added seat" */
    it("says what is due today and the new monthly price", async () => {
      mockPreviewProration.mockReturnValue({ data: addQuote, isLoading: false, isError: false });
      renderSubscriptionPage();

      fireEvent.click(screen.getByTestId("user-count-link"));
      fireEvent.click(await screen.findByTestId("drawer-seats-stepper-plus"));

      expect(seatSummary().getByText("5 \u2192 6")).toBeInTheDocument();
      expect(seatSummary().getByText("\u20ac17.98")).toBeInTheDocument();
      expect(seatSummary().getByText("\u20ac174/mo")).toBeInTheDocument();

      fireEvent.click(button("Add 1 seat \u00b7 \u20ac29/mo"));
      fireEvent.click(await screen.findByRole("button", { name: "Pay \u20ac17.98 and add" }));

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ totalMembers: 6 })),
      );
    });

    /** @scenario "A seat change the payment provider refuses sends no invitations" */
    it("sends no invitation and keeps the drawer open when the seat change fails", async () => {
      mockPreviewProration.mockReturnValue({ data: addQuote, isLoading: false, isError: false });
      mutateAsync.mockRejectedValue(new Error("card declined"));
      renderSubscriptionPage();

      fireEvent.click(screen.getByTestId("user-count-link"));
      fireEvent.click(await screen.findByTestId("add-invite-row"));
      fireEvent.change(await screen.findByTestId("seat-email-0"), {
        target: { value: "new@acme.example" },
      });
      fireEvent.click(screen.getByTestId("drawer-seats-stepper-plus"));
      fireEvent.click(button("Add 1 seat \u00b7 \u20ac29/mo"));
      fireEvent.click(await screen.findByRole("button", { name: "Pay \u20ac17.98 and add" }));

      await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Pay \u20ac17.98 and add" })).toBeEnabled(),
      );
      expect(mockCreateInvitesMutateAsync).not.toHaveBeenCalled();
      expect(screen.getByTestId("seat-email-0")).toHaveValue("new@acme.example");
    });

    it("ends with no pending seat change and invites the new address after adding a seat", async () => {
      mockPreviewProration.mockReturnValue({ data: addQuote, isLoading: false, isError: false });
      renderSubscriptionPage();

      fireEvent.click(screen.getByTestId("user-count-link"));
      fireEvent.click(await screen.findByTestId("add-invite-row"));
      fireEvent.change(await screen.findByTestId("seat-email-0"), {
        target: { value: "new@acme.example" },
      });
      fireEvent.click(screen.getByTestId("drawer-seats-stepper-plus"));
      fireEvent.click(button("Add 1 seat \u00b7 \u20ac29/mo"));
      fireEvent.click(await screen.findByRole("button", { name: "Pay \u20ac17.98 and add" }));

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ totalMembers: 6 })),
      );
      await waitFor(() =>
        expect(mockCreateInvitesMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            invites: [expect.objectContaining({ email: "new@acme.example" })],
          }),
        ),
      );
      expect(screen.queryByTestId("update-seats-block")).toBeNull();
      await waitFor(() => expect(screen.queryByTestId("seat-confirm-dialog")).toBeNull());
    });

    it("ends with no pending seat change after lowering the seats", async () => {
      mockPreviewProration.mockReturnValue({ data: lowerQuote, isLoading: false, isError: false });
      renderSubscriptionPage();

      fireEvent.click(screen.getByTestId("user-count-link"));
      fireEvent.click(await screen.findByTestId("drawer-seats-stepper-minus"));
      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));
      fireEvent.click(button("Lower to 3 seats"));
      fireEvent.click(
        within(await screen.findByTestId("seat-confirm-dialog")).getByRole("button", {
          name: "Lower to 3 seats",
        }),
      );

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ totalMembers: 3 })),
      );
      await waitFor(() => expect(screen.queryByTestId("seat-confirm-dialog")).toBeNull());
      expect(screen.queryByTestId("update-seats-block")).toBeNull();
      expect(mockCreateInvitesMutateAsync).not.toHaveBeenCalled();
    });

    describe("when the seats were lowered to 3 and 5 are kept until 1 Dec", () => {
      beforeEach(() => {
        mockGetLastSubscription.mockReturnValue({
          data: { maxMembers: 3, seatsKept: 5, seatsKeptUntil: "2099-12-01T00:00:00.000Z" },
          isLoading: false,
        });
      });

      /** @scenario "During a lowered period the seat drawer starts from the billed seats" */
      it("counts an added seat from the 3 billed, with nothing due today", async () => {
        mockPreviewProration.mockReturnValue({
          data: { ...lowerQuote, formattedRecurringTotal: "\u20ac116" },
          isLoading: false,
          isError: false,
        });
        renderSubscriptionPage();

        fireEvent.click(screen.getByTestId("user-count-link"));
        fireEvent.click(await screen.findByTestId("drawer-seats-stepper-plus"));

        expect(
          await screen.findByText(
            "Nothing to pay today: you keep 5 seats until 1 Dec, then pay for 4.",
          ),
        ).toBeInTheDocument();
        expect(seatSummary().getByText("3 \u2192 4")).toBeInTheDocument();
        expect(mockPreviewProration).toHaveBeenLastCalledWith(
          expect.objectContaining({ newTotalSeats: 4 }),
        );

        fireEvent.click(button("Add 1 seat \u00b7 \u20ac29/mo"));
        fireEvent.click(
          within(await screen.findByTestId("seat-confirm-dialog")).getByRole("button", {
            name: /Add|Confirm|Pay/,
          }),
        );

        await waitFor(() =>
          expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ totalMembers: 4 })),
        );
      });
    });
  });

  describe("given a contract for 50 seats", () => {
    /** @scenario "A contract plan shows its seats without a seat drawer" */
    it("shows the seats, how to add more, and no way to change them", () => {
      givenPlan({
        type: "ENTERPRISE",
        name: "Enterprise",
        free: false,
        planSource: "license",
        maxMembers: 50,
      });
      renderSubscriptionPage();

      expect(
        screen.getByText(/Your contract covers 50 seats\. Contact LangWatch to add more\./),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Contact us" })).toHaveLength(1);
      expect(screen.queryByTestId("contact-sales-button")).toBeNull();
      expect(screen.queryByTestId("user-count-link")).toBeNull();
      expect(screen.getByTestId("plan-seat-count")).toHaveTextContent("2 / 50");
    });
  });

  describe("given a self-hosted licence for 25 seats", () => {
    /** @scenario "A self-hosted licence shows its seats without a seat drawer" */
    it("shows the seats and how to add more", () => {
      givenPlan({
        type: "ENTERPRISE",
        name: "Enterprise",
        free: false,
        planSource: "license",
        maxMembers: 25,
      });
      renderSubscriptionPage({ saas: false });

      expect(
        screen.getByText(/Your licence covers 25 seats\. Contact LangWatch to add more\./),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Contact us" })).toHaveLength(1);
      expect(screen.queryByTestId("contact-sales-button")).toBeNull();
      expect(screen.queryByTestId("user-count-link")).toBeNull();
    });
  });
});
