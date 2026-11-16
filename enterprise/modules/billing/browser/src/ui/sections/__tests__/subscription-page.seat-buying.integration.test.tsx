/**
 * @vitest-environment jsdom
 * Buying seats: the upgrade seat dialog, Manage seats on Free and on Growth, Other seat types.
 * @see specs/licensing/seat-buying.feature
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
import { checkoutIntentHref } from "../../../model/checkout-intent.ts";
import { SubscriptionPage } from "../subscription-page.tsx";
import {
  createMockPlan,
  mockAddTeamMemberOrEvents,
  mockCreateInvitesMutateAsync,
  mockCreateSubscription,
  mockDeveloperSeats,
  mockDeveloperSeatsRefetch,
  mockGetActivePlan,
  mockGetOrganizationWithMembers,
  mockGetUsage,
  mockListHeldSeats,
  mockOrganization,
  mockPreviewDeveloperSeats,
  mockSetDeveloperSeats,
  mockUpgradeWithInvites,
  resetMocks,
  setMockOrganization,
} from "./subscription-test-setup.ts";

const { mockPreviewProration } = vi.hoisted(() => ({ mockPreviewProration: vi.fn() }));

/** Whether the reader holds `organization:manage`, which listing held seats needs. */
const hostReadsHeldSeats = { current: true };

const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_seats";
const DEC_1 = Date.UTC(2026, 11, 1);

class TestBillingHost extends BillingHostApi {
  canReadMonthBreakdown(): boolean {
    return true;
  }
  canReadHeldSeats(): boolean {
    return hostReadsHeldSeats.current;
  }

  readonly successes: BillingSuccessNotice[] = [];
  readonly failures: BillingFailureNotice[] = [];
  readonly departures: string[] = [];

  constructor(private query: Record<string, string | undefined>) {
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

  replace(): void {
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

const renderPage = (query: Record<string, string | undefined> = {}) => {
  const host = new TestBillingHost(query);
  render(<SubscriptionPage />, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <DesignSystemProvider forcedTheme="light">
        <BillingHostProvider value={host}>{children}</BillingHostProvider>
      </DesignSystemProvider>
    ),
  });
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
        listHeldSeats: {
          useQuery: (_input: unknown, opts: { enabled: boolean }) =>
            opts.enabled ? setup.mockListHeldSeats() : { data: undefined },
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
        organization: { getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() } },
      })),
    },
  };
});

/** A seat the server holds for a removed person until 7 Dec. */
const heldUntilDec7 = {
  userId: "removed-user",
  email: "removed@acme.example",
  seatFreesAt: "2026-12-07T10:00:00.000Z",
};

/** The full seats enforcement counts in use, members, invites and holds together. */
const givenMembersCount = (membersCount: number) =>
  mockGetUsage.mockReturnValue({
    data: { seatLimitInfo: { status: "ok", message: "" }, membersCount },
    isLoading: false,
    refetch: vi.fn(),
  } as ReturnType<typeof mockGetUsage>);

/** `count` full members, as the page and the usage count both read them. */
const givenMembers = (count: number) => {
  mockGetOrganizationWithMembers.mockReturnValue({
    data: {
      id: "test-org-id",
      name: "Test Org",
      members: Array.from({ length: count }, (_, index) => ({
        userId: `user-${index}`,
        role: index === 0 ? "ADMIN" : "MEMBER",
        user: {
          id: `user-${index}`,
          name: `Member ${index}`,
          email: `member${index}@acme.example`,
          teamMemberships: [],
        },
      })),
    },
    isLoading: false,
    refetch: vi.fn(),
  } as ReturnType<typeof mockGetOrganizationWithMembers>);
  mockGetUsage.mockReturnValue({
    data: { seatLimitInfo: { status: "ok", message: "" }, membersCount: count },
    isLoading: false,
    refetch: vi.fn(),
  } as ReturnType<typeof mockGetUsage>);
};

const givenFree = (members: number) => {
  givenMembers(members);
  mockGetActivePlan.mockReturnValue({
    data: createMockPlan({ maxMembers: 2 }),
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenGrowth = ({ paid, inUse }: { paid: number; inUse: number }) => {
  setMockOrganization({
    id: "test-org-id",
    name: "Test Org",
    currency: "EUR",
    pricingModel: "SEAT_EVENT",
  });
  givenMembers(inUse);
  mockGetActivePlan.mockReturnValue({
    data: createMockPlan({
      type: "GROWTH_SEAT_EUR_MONTHLY",
      name: "Growth",
      free: false,
      planSource: "subscription",
      maxMembers: paid,
    }),
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenCheckout = (answer: () => Promise<{ url: string | null }>) => {
  const mutateAsync = vi.fn(answer);
  mockCreateSubscription.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync,
    isLoading: false,
    isPending: false,
  });
  return mutateAsync;
};

const givenInviteCheckout = () => {
  const mutateAsync = vi.fn(async () => ({ url: CHECKOUT_URL }));
  mockUpgradeWithInvites.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync,
    isLoading: false,
    isPending: false,
  } as ReturnType<typeof mockUpgradeWithInvites>);
  return mutateAsync;
};

const addQuote = {
  amountDueCents: 2417,
  formattedAmountDue: "€24.17",
  formattedCreditApplied: null,
  formattedRecurringTotal: "€116",
  billingInterval: "month",
  quotedAt: 1_700_000_000,
  appliesAt: null,
  keptSeats: null,
  formattedKeptRecurringTotal: null,
};

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

const lastButton = (name: string | RegExp) => {
  const found = screen.getAllByRole("button", { name });
  return found[found.length - 1]!;
};

const summary = () => {
  const found = screen.getAllByTestId("seat-change-summary");
  return within(found[found.length - 1]!);
};

const openSeatDialog = async () => {
  const card = await screen.findByTestId("current-plan-block");
  fireEvent.click(within(card).getByRole("button", { name: "Upgrade to Growth" }));
  return screen.findByTestId("upgrade-seats-dialog");
};

const openManageSeats = async () => {
  fireEvent.click(await screen.findByTestId("user-count-link"));
  await screen.findByTestId("add-invite-row");
};

const addPerson = (email: string) => {
  const index = screen.queryAllByTestId(/^seat-email-\d+$/).length;
  fireEvent.click(screen.getByTestId("add-invite-row"));
  fireEvent.change(screen.getByTestId(`seat-email-${index}`), { target: { value: email } });
};

describe("<SubscriptionPage/> buying seats", () => {
  let seatChange: Mock<(input: unknown) => Promise<{ success: boolean }>>;

  beforeEach(() => {
    resetMocks();
    hostReadsHeldSeats.current = true;
    seatChange = vi.fn(async (_input: unknown) => ({ success: true }));
    mockAddTeamMemberOrEvents.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: seatChange,
      isLoading: false,
      isPending: false,
    });
  });

  afterEach(() => cleanup());

  describe("given a Free organization upgrading from the seat dialog", () => {
    /** @scenario "Upgrade to Growth on the plan card opens the seat dialog" */
    it("opens the dialog at the people already counted, with no checkout", async () => {
      givenFree(1);
      const checkout = givenCheckout(async () => ({ url: CHECKOUT_URL }));
      renderPage();

      const dialog = within(await openSeatDialog());

      expect(dialog.getByText("Upgrade to Growth")).toBeInTheDocument();
      expect(dialog.getByTestId("upgrade-seats-stepper-value")).toHaveTextContent("1");
      expect(
        dialog.getByText("200,000 events a month included. Lite members free."),
      ).toBeInTheDocument();
      expect(dialog.getByText("Invite people after checkout.")).toBeInTheDocument();
      expect(checkout).not.toHaveBeenCalled();
    });

    /** @scenario "The seat dialog totals the price as the seats change" */
    it("totals the price as the seats rise", async () => {
      givenFree(1);
      renderPage();

      const dialog = within(await openSeatDialog());
      fireEvent.click(dialog.getByTestId("upgrade-seats-stepper-plus"));
      fireEvent.click(dialog.getByTestId("upgrade-seats-stepper-plus"));

      const total = within(dialog.getByTestId("upgrade-seats-total"));
      expect(total.getByText("€87/mo")).toBeInTheDocument();
      expect(total.getByText("3 seats × €29")).toBeInTheDocument();
    });

    /** @scenario "The seat dialog says its total excludes VAT" */
    it("says the total excludes VAT", async () => {
      givenFree(1);
      renderPage();

      const total = within(within(await openSeatDialog()).getByTestId("upgrade-seats-total"));
      expect(total.getByText("€29/mo")).toBeInTheDocument();
      expect(total.getByText("excl. VAT")).toBeInTheDocument();
    });

    /** @scenario "The Growth offer says its price excludes VAT" */
    it("says the Growth offer's price excludes VAT", async () => {
      givenFree(2);
      renderPage();

      const offer = await screen.findByTestId("upgrade-total");
      expect(offer).toHaveTextContent("€58/mo for 2 seats");
      expect(offer).toHaveTextContent("excl. VAT");
    });

    /** @scenario "The seat dialog never goes below the people already in the organization" */
    it("starts at the people in the organization and cannot go lower", async () => {
      givenFree(3);
      renderPage();

      const dialog = within(await openSeatDialog());

      expect(dialog.getByTestId("upgrade-seats-stepper-value")).toHaveTextContent("3");
      expect(dialog.getByTestId("upgrade-seats-stepper-minus")).toBeDisabled();
      expect(
        dialog.getByText(
          "3 people are already in your organization, so you need at least 3 full seats.",
        ),
      ).toBeInTheDocument();
    });

    /** @scenario "Continue to checkout starts the Growth checkout for the chosen seats" */
    it("creates the monthly euro checkout for the chosen seats and leaves for it", async () => {
      givenFree(1);
      const checkout = givenCheckout(async () => ({ url: CHECKOUT_URL }));
      const host = renderPage();

      const dialog = within(await openSeatDialog());
      fireEvent.click(dialog.getByTestId("upgrade-seats-stepper-plus"));
      fireEvent.click(dialog.getByTestId("upgrade-seats-stepper-plus"));
      fireEvent.click(dialog.getByRole("button", { name: "Continue to checkout" }));

      await waitFor(() => expect(host.departures).toEqual([CHECKOUT_URL]));
      expect(checkout).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          membersToAdd: 3,
          currency: "EUR",
          billingInterval: "monthly",
        }),
      );
    });

    /** @scenario "Cancel closes the seat dialog without a checkout" */
    it("closes on Cancel with no checkout", async () => {
      givenFree(1);
      const checkout = givenCheckout(async () => ({ url: CHECKOUT_URL }));
      renderPage();

      const dialog = within(await openSeatDialog());
      fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Continue to checkout" })).toBeNull(),
      );
      expect(checkout).not.toHaveBeenCalled();
    });

    /** @scenario "A checkout that fails to start says why and keeps the dialog open" */
    it("reports a refused checkout and keeps the dialog with its seats", async () => {
      givenFree(1);
      const refusal = new Error("provider refused");
      givenCheckout(() => Promise.reject(refusal));
      const host = renderPage();

      const dialog = within(await openSeatDialog());
      fireEvent.click(dialog.getByTestId("upgrade-seats-stepper-plus"));
      fireEvent.click(dialog.getByTestId("upgrade-seats-stepper-plus"));
      fireEvent.click(dialog.getByRole("button", { name: "Continue to checkout" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]).toMatchObject({ fallbackTitle: "Couldn't upgrade your plan" });
      expect(host.departures).toEqual([]);
      expect(screen.getByTestId("upgrade-seats-stepper-value")).toHaveTextContent("3");
    });

    /** @scenario "The Growth offer opens the seat dialog" */
    it("opens the dialog from the Growth offer", async () => {
      givenFree(1);
      const checkout = givenCheckout(async () => ({ url: CHECKOUT_URL }));
      renderPage();

      const offer = await screen.findByTestId("upgrade-plan-block");
      fireEvent.click(within(offer).getByRole("button", { name: /Upgrade now/i }));

      expect(await screen.findByTestId("upgrade-seats-dialog")).toBeInTheDocument();
      expect(checkout).not.toHaveBeenCalled();
    });

    /** @scenario "Arriving from All plans opens the seat dialog in the chosen interval and currency" */
    it("opens the dialog in annual USD and checks out only on Continue", async () => {
      givenFree(2);
      const checkout = givenCheckout(async () => ({ url: CHECKOUT_URL }));
      const href = checkoutIntentHref({ interval: "annual", currency: "USD" });
      renderPage(Object.fromEntries(new URL(href, "http://localhost").searchParams));

      const dialog = within(await screen.findByTestId("upgrade-seats-dialog"));
      expect(dialog.getByTestId("upgrade-seats-stepper-value")).toHaveTextContent("2");
      expect(dialog.getByTestId("upgrade-seats-total")).toHaveTextContent("$");
      expect(dialog.getByTestId("upgrade-seats-total")).toHaveTextContent("/yr");
      expect(checkout).not.toHaveBeenCalled();

      fireEvent.click(dialog.getByRole("button", { name: "Continue to checkout" }));

      await waitFor(() =>
        expect(checkout).toHaveBeenCalledWith(
          expect.objectContaining({ currency: "USD", billingInterval: "annual", membersToAdd: 2 }),
        ),
      );
    });

    /** @scenario "The plan card and the seat dialog never show Developer seats" */
    it("never mentions Developer seats on the plan card or in the dialog", async () => {
      givenFree(1);
      mockDeveloperSeats.mockReturnValue({
        data: {
          available: true,
          quantity: 0,
          unitAmountCents: 500,
          currency: "EUR",
          billingInterval: "month",
          periodEndsAt: DEC_1,
        },
        isLoading: false,
      });
      renderPage();

      const dialog = await openSeatDialog();

      expect(within(screen.getByTestId("current-plan-block")).queryByText(/developer/i)).toBeNull();
      expect(within(dialog).queryByText(/developer/i)).toBeNull();
    });
  });

  describe("given Manage seats on Free", () => {
    /** @scenario "Manage seats on Free says what Free includes" */
    it("says what Free includes and has nothing to confirm", async () => {
      givenFree(1);
      renderPage();
      await openManageSeats();

      expect(screen.getByTestId("seat-drawer-heading")).toHaveTextContent(
        "Free includes 2 seats. 1 in use.",
      );
      expect(summary().getByText("Free")).toBeInTheDocument();
      expect(summary().getByText("1 of 2 included")).toBeInTheDocument();
      expect(summary().getByText("€0")).toBeInTheDocument();
      expect(lastButton("No changes")).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
      expect(screen.queryByTestId("other-seat-types")).toBeNull();
    });

    /** @scenario "Manage seats on Free names a held seat and the day it frees" */
    it("names the seat the server holds and the day it frees", async () => {
      givenFree(1);
      givenMembersCount(2);
      mockListHeldSeats.mockReturnValue({
        data: { heldSeats: [heldUntilDec7] },
      });
      renderPage();
      await openManageSeats();

      expect(screen.getByTestId("seat-drawer-heading")).toHaveTextContent(
        "Free includes 2 seats. 2 in use, 1 of them held until 7 Dec.",
      );
    });

    /** @scenario "Manage seats on Free names a held seat and the day it frees" */
    it("calls no seat held when the server lists no hold", async () => {
      givenFree(1);
      givenMembersCount(2);
      renderPage();
      await openManageSeats();

      expect(screen.getByTestId("seat-drawer-heading")).toHaveTextContent(
        "Free includes 2 seats. 2 in use.",
      );
    });

    /** @scenario "A reader who may not manage the organization sees no held seats" */
    it("asks for no held seats when the reader may not manage the organization", async () => {
      hostReadsHeldSeats.current = false;
      givenFree(1);
      givenMembersCount(2);
      mockListHeldSeats.mockReturnValue({ data: { heldSeats: [heldUntilDec7] } });
      renderPage();
      await openManageSeats();

      expect(mockListHeldSeats).not.toHaveBeenCalled();
      expect(screen.getByTestId("seat-drawer-heading")).toHaveTextContent(
        "Free includes 2 seats. 2 in use.",
      );
    });

    /** @scenario "An invite that fits Free is sent at once" */
    it("invites into Free at once", async () => {
      givenFree(1);
      const checkout = givenCheckout(async () => ({ url: CHECKOUT_URL }));
      renderPage();
      await openManageSeats();

      addPerson("maria@acme.example");

      expect(screen.getByTestId("invite-chip-0")).toHaveTextContent("Invited now");
      fireEvent.click(lastButton("Invite 1 person"));

      await waitFor(() =>
        expect(mockCreateInvitesMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            invites: [expect.objectContaining({ email: "maria@acme.example" })],
          }),
        ),
      );
      expect(checkout).not.toHaveBeenCalled();
    });

    /** @scenario "Planning more people than Free covers turns the confirm into the upgrade" */
    it("turns the confirm into the upgrade past what Free covers", async () => {
      givenFree(1);
      renderPage();
      await openManageSeats();

      addPerson("maria@acme.example");
      addPerson("joao@acme.example");

      expect(lastButton("Upgrade and invite 2 people · €87/mo")).toBeEnabled();
      expect(screen.getByTestId("invite-chip-0")).toHaveTextContent("Invited after payment");
      expect(screen.getByTestId("invite-chip-1")).toHaveTextContent("Invited after payment");
      expect(screen.getByTestId("seat-drawer-note")).toHaveTextContent(
        "3 people is more than Free covers. Growth bills every full seat, 3 × €29.",
      );
      expect(summary().getByText("Free → Growth")).toBeInTheDocument();
      expect(summary().getByText("3 × €29")).toBeInTheDocument();
      expect(summary().getByText("€87/mo")).toBeInTheDocument();
    });

    /** @scenario "The upgrade from Manage seats checks out with the invites held until payment" */
    it("checks out for the seats carrying the invites, inviting nobody yet", async () => {
      givenFree(1);
      const inviteCheckout = givenInviteCheckout();
      const host = renderPage();
      await openManageSeats();

      addPerson("maria@acme.example");
      addPerson("joao@acme.example");
      fireEvent.click(lastButton("Upgrade and invite 2 people · €87/mo"));

      await waitFor(() => expect(host.departures).toEqual([CHECKOUT_URL]));
      expect(inviteCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSeats: 3,
          invites: [
            expect.objectContaining({ email: "maria@acme.example" }),
            expect.objectContaining({ email: "joao@acme.example" }),
          ],
        }),
      );
      expect(mockCreateInvitesMutateAsync).not.toHaveBeenCalled();
    });

    /** @scenario "An address that is not an email blocks the confirm" */
    it("blocks the confirm on an address that is not an email", async () => {
      givenFree(1);
      const checkout = givenCheckout(async () => ({ url: CHECKOUT_URL }));
      renderPage();
      await openManageSeats();

      addPerson("not-an-email");
      fireEvent.click(lastButton("Invite 1 person"));

      expect(await screen.findByText("Please enter a valid email address")).toBeInTheDocument();
      expect(mockCreateInvitesMutateAsync).not.toHaveBeenCalled();
      expect(checkout).not.toHaveBeenCalled();
    });

    /** @scenario "Planning people in Manage seats never marks an upgrade as required" */
    it("leaves the plan card as it was after planning and cancelling", async () => {
      givenFree(1);
      renderPage();
      await openManageSeats();

      addPerson("maria@acme.example");
      addPerson("joao@acme.example");
      fireEvent.click(lastButton("Cancel"));

      await waitFor(() => expect(screen.queryByTestId("add-invite-row")).toBeNull());
      expect(screen.getByTestId("plan-seat-count")).toHaveTextContent("1 / 2");
      expect(screen.queryByTestId("upgrade-required-chip")).toBeNull();
      expect(mockCreateInvitesMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe("given Manage seats on Growth", () => {
    beforeEach(() => {
      mockPreviewProration.mockImplementation((input: { newTotalSeats: number }) => ({
        data: input.newTotalSeats === 3 ? lowerQuote : addQuote,
        isLoading: false,
        isError: false,
      }));
    });

    /** @scenario "Manage seats on Growth shows the seats paid for" */
    it("shows the seats paid for and nothing to confirm", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      expect(screen.getByTestId("seat-drawer-heading")).toHaveTextContent(
        "You pay for 3. 3 in use.",
      );
      expect(screen.getByTestId("drawer-seats-stepper-value")).toHaveTextContent("3");
      expect(lastButton("No changes")).toBeDisabled();
    });

    /** @scenario "Inviting past the seats paid for raises the count" */
    it("raises the seats for an invite past the seats paid for", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");

      expect(screen.getByTestId("drawer-seats-stepper-value")).toHaveTextContent("4");
      expect(screen.getByTestId("invite-chip-0")).toHaveTextContent("Invited when you confirm");
      expect(lastButton("Add 1 seat · €29/mo")).toBeEnabled();
      expect(summary().getByText("3 → 4")).toBeInTheDocument();
      expect(summary().getByText("€24.17")).toBeInTheDocument();
      expect(summary().getByText("€116/mo")).toBeInTheDocument();
      expect(screen.getByTestId("seat-drawer-note")).toHaveTextContent(
        "Added to your subscription now, prorated to 1 Dec. No new checkout.",
      );
    });

    /** @scenario "The quote tells the drawer when the next period starts" */
    it("names the day the next period starts", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      fireEvent.click(screen.getByTestId("drawer-seats-stepper-plus"));

      expect(summary().getByText("Then from 1 Dec")).toBeInTheDocument();
    });

    /** @scenario "Adding seats asks to confirm the charge" */
    it("asks to confirm the charge for the added seat", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");
      fireEvent.click(lastButton("Add 1 seat · €29/mo"));

      const confirm = within(await screen.findByTestId("seat-confirm-dialog"));
      expect(confirm.getByText("Add 1 seat to your organization?")).toBeInTheDocument();
      expect(
        confirm.getByText(/Charged today to the card on file, for .* to 1 Dec\./),
      ).toBeInTheDocument();
      expect(confirm.getByText("4 seats × €29")).toBeInTheDocument();
      expect(confirm.getByTestId("seat-confirm-body")).toHaveTextContent(
        "qux@acme.example gets the invite as soon as the seat is added.",
      );
      expect(confirm.getByRole("button", { name: "Pay €24.17 and add" })).toBeEnabled();
    });

    /** @scenario "The seat change confirm splits VAT out of the charge today" */
    it("charges the VAT-inclusive amount today and splits the VAT out", async () => {
      mockPreviewProration.mockImplementation(() => ({
        data: {
          ...addQuote,
          amountDueCents: 2924,
          formattedAmountDue: "€29.24",
          taxCents: 507,
          formattedAmountDueExcludingTax: "€24.17",
          formattedTax: "€5.07",
        },
        isLoading: false,
        isError: false,
      }));
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");
      fireEvent.click(lastButton("Add 1 seat · €29/mo"));

      const confirm = within(await screen.findByTestId("seat-confirm-dialog"));
      expect(confirm.getByText("€29.24")).toBeInTheDocument();
      expect(confirm.getByText("€24.17 + €5.07 VAT")).toBeInTheDocument();
      expect(confirm.getByText("€116/mo")).toBeInTheDocument();
      expect(confirm.getByText("excl. VAT")).toBeInTheDocument();
      expect(confirm.getByRole("button", { name: "Pay €29.24 and add" })).toBeEnabled();
    });

    /** @scenario "Confirming the added seat changes the subscription and sends the invite" */
    it("changes the subscription at the quote, invites and closes", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      const host = renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");
      fireEvent.click(lastButton("Add 1 seat · €29/mo"));
      fireEvent.click(await screen.findByRole("button", { name: "Pay €24.17 and add" }));

      await waitFor(() =>
        expect(seatChange).toHaveBeenCalledWith(
          expect.objectContaining({ totalMembers: 4, quotedAt: addQuote.quotedAt }),
        ),
      );
      await waitFor(() =>
        expect(mockCreateInvitesMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            invites: [expect.objectContaining({ email: "qux@acme.example" })],
          }),
        ),
      );
      await waitFor(() =>
        expect(host.successes).toContainEqual(
          expect.objectContaining({
            title: "Seat added. You now pay for 4 seats. Invite sent to qux@acme.example.",
          }),
        ),
      );
      await waitFor(() => expect(screen.queryByTestId("add-invite-row")).toBeNull());
      expect(screen.queryByTestId("update-seats-block")).toBeNull();
    });

    /** @scenario "Back from the confirm returns to the drawer unchanged" */
    it("goes back to the drawer unchanged", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");
      fireEvent.click(lastButton("Add 1 seat · €29/mo"));
      const confirm = within(await screen.findByTestId("seat-confirm-dialog"));
      fireEvent.click(confirm.getByRole("button", { name: "Back" }));

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Pay €24.17 and add" })).toBeNull(),
      );
      expect(screen.getByTestId("drawer-seats-stepper-value")).toHaveTextContent("4");
      expect(screen.getByTestId("seat-email-0")).toHaveValue("qux@acme.example");
      expect(seatChange).not.toHaveBeenCalled();
    });

    /** @scenario "Inviting into a seat already paid for sends the invite at once" */
    it("invites into a seat already paid for without changing the subscription", async () => {
      givenGrowth({ paid: 5, inUse: 3 });
      renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");

      expect(screen.getByTestId("drawer-seats-stepper-value")).toHaveTextContent("5");
      fireEvent.click(lastButton("Invite 1 person"));

      await waitFor(() =>
        expect(mockCreateInvitesMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            invites: [expect.objectContaining({ email: "qux@acme.example" })],
          }),
        ),
      );
      expect(seatChange).not.toHaveBeenCalled();
    });

    /** @scenario "Lowering seats stops at the people who use them" */
    it("stops lowering at the people who use the seats", async () => {
      givenGrowth({ paid: 5, inUse: 3 });
      renderPage();
      await openManageSeats();

      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));
      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));

      expect(screen.getByTestId("drawer-seats-stepper-value")).toHaveTextContent("3");
      expect(screen.getByTestId("drawer-seats-stepper-minus")).toBeDisabled();
      expect(screen.getByTestId("seat-drawer-minimum")).toHaveTextContent(
        "3 people use full seats. Remove someone in Users to go lower.",
      );
    });

    /** @scenario "Lowering seats names the seats held for people who left them" */
    it("names the held seat in the heading and where lowering stops", async () => {
      givenGrowth({ paid: 5, inUse: 2 });
      givenMembersCount(3);
      mockListHeldSeats.mockReturnValue({
        data: { heldSeats: [heldUntilDec7] },
      });
      renderPage();
      await openManageSeats();

      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));
      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));

      expect(screen.getByTestId("seat-drawer-heading")).toHaveTextContent(
        "You pay for 5. 3 in use, 1 of them held until 7 Dec.",
      );
      expect(screen.getByTestId("drawer-seats-stepper-minus")).toBeDisabled();
      expect(screen.getByTestId("seat-drawer-minimum")).toHaveTextContent(
        "2 people use full seats and 1 more is held until 7 Dec. Remove someone in Users to go lower.",
      );
    });

    /** @scenario "Lowering seats asks to confirm from the next period" */
    it("confirms a lower count from the next period", async () => {
      givenGrowth({ paid: 5, inUse: 3 });
      const host = renderPage();
      await openManageSeats();

      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));
      fireEvent.click(screen.getByTestId("drawer-seats-stepper-minus"));
      fireEvent.click(lastButton("Lower to 3 seats"));

      const confirm = within(await screen.findByTestId("seat-confirm-dialog"));
      expect(confirm.getByText("Lower to 3 seats from 1 Dec?")).toBeInTheDocument();
      expect(confirm.getByTestId("seat-confirm-body")).toHaveTextContent(
        "You keep 5 seats until 1 Dec. From then you pay €87/mo for 3. No refund for the rest of this month.",
      );
      fireEvent.click(confirm.getByRole("button", { name: "Lower to 3 seats" }));

      await waitFor(() =>
        expect(seatChange).toHaveBeenCalledWith(expect.objectContaining({ totalMembers: 3 })),
      );
      await waitFor(() =>
        expect(host.successes).toContainEqual(
          expect.objectContaining({ title: "From 1 Dec you pay for 3 seats." }),
        ),
      );
    });

    /** @scenario "A price that did not load keeps the confirm from being chosen" */
    it("keeps the confirm disabled when the price did not load", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      mockPreviewProration.mockImplementation(() => ({
        data: undefined,
        isLoading: false,
        isError: true,
      }));
      renderPage();
      await openManageSeats();

      fireEvent.click(screen.getByTestId("drawer-seats-stepper-plus"));

      const confirm = lastButton("Add 1 seat · €29/mo");
      expect(confirm).toBeDisabled();
      expect(screen.getByTestId("seat-drawer-price-failed")).toHaveTextContent(
        "The price for this change did not load.",
      );
    });

    /** @scenario "A charge the payment provider refuses keeps the confirm open and invites nobody" */
    it("reports a refused charge, invites nobody and keeps the confirm open", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      seatChange.mockRejectedValue(new Error("card declined"));
      const host = renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");
      fireEvent.click(lastButton("Add 1 seat · €29/mo"));
      fireEvent.click(await screen.findByRole("button", { name: "Pay €24.17 and add" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(mockCreateInvitesMutateAsync).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Pay €24.17 and add" })).toBeEnabled();
    });

    /** @scenario "An invite refused after the seats changed keeps Manage seats open" */
    it("keeps Manage seats open without the success message when the invite is refused", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      mockCreateInvitesMutateAsync.mockRejectedValueOnce(new Error("invite refused"));
      const host = renderPage();
      await openManageSeats();

      addPerson("qux@acme.example");
      fireEvent.click(lastButton("Add 1 seat · €29/mo"));
      fireEvent.click(await screen.findByRole("button", { name: "Pay €24.17 and add" }));

      await waitFor(() =>
        expect(seatChange).toHaveBeenCalledWith(expect.objectContaining({ totalMembers: 4 })),
      );
      await waitFor(() =>
        expect(host.failures).toContainEqual(
          expect.objectContaining({ fallbackTitle: "Couldn't send invites" }),
        ),
      );
      expect(host.successes).toEqual([]);
      await waitFor(() => expect(screen.queryByTestId("seat-confirm-dialog")).toBeNull());
      expect(screen.getByTestId("add-invite-row")).toBeInTheDocument();
    });
  });

  describe("given Other seat types on Growth", () => {
    const givenDeveloperPrice = (quantity = 0) => {
      mockDeveloperSeats.mockReturnValue({
        data: {
          available: true,
          quantity,
          unitAmountCents: 500,
          currency: "EUR",
          billingInterval: "month",
          periodEndsAt: DEC_1,
        },
        isLoading: false,
      });
      mockPreviewDeveloperSeats.mockReturnValue({
        data: {
          amountDueCents: 833,
          formattedAmountDue: "€8.33",
          formattedRecurringTotal: "€10",
          billingInterval: "month",
          quotedAt: 1_700_000_100,
        },
        isLoading: false,
        isError: false,
      });
    };

    const unfold = () =>
      fireEvent.click(
        within(screen.getByTestId("other-seat-types")).getByRole("button", {
          name: /Other seat types/,
        }),
      );

    /** `developers` Developers in use beside `members` full members, as the server counts them. */
    const givenDevelopersInUse = ({
      members,
      developers,
    }: {
      members: number;
      developers: number;
    }) =>
      mockGetUsage.mockReturnValue({
        data: {
          seatLimitInfo: { status: "ok", message: "" },
          membersCount: members,
          membersDeveloperCount: developers,
        },
        isLoading: false,
        refetch: vi.fn(),
      } as ReturnType<typeof mockGetUsage>);

    /** @scenario "The Developer seat stepper stops at the Developers in use" */
    it("stops lowering Developer seats at the Developers in use and says why", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      givenDevelopersInUse({ members: 3, developers: 2 });
      givenDeveloperPrice(3);
      renderPage();
      await openManageSeats();

      unfold();
      fireEvent.click(await screen.findByTestId("developer-seats-stepper-minus"));
      fireEvent.click(screen.getByTestId("developer-seats-stepper-minus"));

      expect(screen.getByTestId("developer-seats-stepper-value")).toHaveTextContent("2");
      expect(screen.getByTestId("developer-seats-stepper-minus")).toBeDisabled();
      expect(screen.getByTestId("developer-seats-minimum")).toHaveTextContent(
        "2 people use Developer seats. Remove someone in Users to go lower.",
      );
    });

    /** @scenario "Raising Developer seats skips the counts below the Developers in use" */
    it("raises Developer seats straight to the Developers in use", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      givenDevelopersInUse({ members: 3, developers: 2 });
      givenDeveloperPrice(0);
      renderPage();
      await openManageSeats();

      unfold();
      fireEvent.click(await screen.findByTestId("developer-seats-stepper-plus"));

      expect(screen.getByTestId("developer-seats-stepper-value")).toHaveTextContent("2");
      expect(screen.getByTestId("developer-seats-minimum")).toHaveTextContent(
        "2 people use Developer seats, so you need at least 2.",
      );
      fireEvent.click(screen.getByTestId("developer-seats-stepper-minus"));
      expect(screen.getByTestId("developer-seats-stepper-value")).toHaveTextContent("0");
    });

    /** @scenario "Other seat types are folded at the bottom of Manage seats on Growth" */
    it("folds Lite members under Other seat types", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      expect(screen.getByTestId("other-seat-types")).toHaveAttribute("data-state", "closed");
      unfold();

      const lite = within(await screen.findByTestId("seat-type-lite"));
      expect(lite.getByText("Lite members")).toBeInTheDocument();
      expect(lite.getByText("Read only. Free and unlimited on Growth.")).toBeInTheDocument();
      expect(lite.getByText("Free")).toBeInTheDocument();
    });

    /** @scenario "Developer seats are not offered while no Developer price is configured" */
    it("offers no Developer row without a price", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      renderPage();
      await openManageSeats();

      unfold();

      await screen.findByTestId("seat-type-lite");
      expect(screen.queryByTestId("seat-type-developer")).toBeNull();
    });

    /** @scenario "Adding Developer seats prices them" */
    it("prices added Developer seats", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      givenDeveloperPrice();
      renderPage();
      await openManageSeats();

      unfold();
      fireEvent.click(await screen.findByTestId("developer-seats-stepper-plus"));
      fireEvent.click(screen.getByTestId("developer-seats-stepper-plus"));

      expect(lastButton("Add 2 developer seats · €10/mo")).toBeEnabled();
      expect(summary().getByText("Developer seats")).toBeInTheDocument();
      expect(summary().getByText("2 × €5")).toBeInTheDocument();
    });

    /** @scenario "Confirming Developer seats changes the subscription" */
    it("sets the Developer seats at the quote on confirm", async () => {
      givenGrowth({ paid: 3, inUse: 3 });
      givenDeveloperPrice();
      const host = renderPage();
      await openManageSeats();

      unfold();
      fireEvent.click(await screen.findByTestId("developer-seats-stepper-plus"));
      fireEvent.click(screen.getByTestId("developer-seats-stepper-plus"));
      fireEvent.click(lastButton("Add 2 developer seats · €10/mo"));
      const confirm = within(await screen.findByTestId("seat-confirm-dialog"));
      fireEvent.click(
        confirm.getAllByRole("button").find((b) => /Pay|Confirm|Add/.test(b.textContent ?? ""))!,
      );

      await waitFor(() =>
        expect(mockSetDeveloperSeats).toHaveBeenCalledWith(
          expect.objectContaining({ quantity: 2, quotedAt: 1_700_000_100 }),
        ),
      );
      expect(seatChange).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(host.successes).toContainEqual(
          expect.objectContaining({ title: "You now pay for 2 developer seats." }),
        ),
      );

      const refetchesBefore = mockDeveloperSeatsRefetch.mock.calls.length;
      await openManageSeats();
      await waitFor(() =>
        expect(mockDeveloperSeatsRefetch.mock.calls.length).toBeGreaterThan(refetchesBefore),
      );
    });
  });
});
