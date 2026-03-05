/**
 * @vitest-environment jsdom
 *
 * Integration tests for SubscriptionPage — billing toggles, dynamic pricing,
 * seat updates, onConfirm behaviour, billing consistency, and plan currency
 * variants (GROWTH_SEAT_EUR_ANNUAL, GROWTH_SEAT_USD_MONTHLY).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPage } from "../SubscriptionPage";
import {
  createMockPlan,
  mockCreateInvites,
  mockCreateInvitesMutate,
  mockCreateSubscription,
  mockDetectCurrency,
  mockGetActivePlan,
  mockGetOrganizationWithMembers,
  mockGetPendingInvites,
  mockAddTeamMemberOrEvents,
  mockManageSubscription,
  mockOpenSeats,
  mockUpdateUsers,
  mockUpgradeWithInvites,
  mockOrganizationMembers,
  resetMocks,
  setMockOrganization,
} from "./subscription-test-setup";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderSubscriptionPage = () => {
  return render(<SubscriptionPage />, { wrapper: Wrapper });
};

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted — must be at module top-level)
// ---------------------------------------------------------------------------
vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const setup = await import("./subscription-test-setup");
  return {
    useOrganizationTeamProject: () => ({
      project: { id: "test-project-id", slug: "test-project" },
      organization: setup.mockOrganization,
      team: { id: "test-team-id" },
    }),
  };
});

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../../stores/upgradeModalStore", async () => {
  const setup = await import("./subscription-test-setup");
  return {
    useUpgradeModalStore: (selector: (state: { openSeats: typeof setup.mockOpenSeats }) => unknown) =>
      selector({ openSeats: setup.mockOpenSeats }),
  };
});

vi.mock("~/utils/api", async () => {
  const setup = await import("./subscription-test-setup");
  return {
    api: {
      plan: {
        getActivePlan: {
          useQuery: () => setup.mockGetActivePlan(),
        },
      },
      organization: {
        getOrganizationWithMembersAndTheirTeams: {
          useQuery: () => setup.mockGetOrganizationWithMembers(),
        },
        getOrganizationPendingInvites: {
          useQuery: () => ({ ...setup.mockGetPendingInvites(), refetch: vi.fn() }),
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
        upgradeWithInvites: {
          useMutation: () => setup.mockUpgradeWithInvites(),
        },
        addTeamMemberOrEvents: {
          useMutation: () => setup.mockAddTeamMemberOrEvents(),
        },
        manage: {
          useMutation: () => setup.mockManageSubscription(),
        },
      },
      useContext: vi.fn(() => ({
        organization: {
          getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() },
        },
      })),
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<SubscriptionPage/>", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ============================================================================
  // Billing Toggles and Dynamic Pricing
  // ============================================================================

  describe("when viewing billing toggles", () => {
    it("shows currency selector defaulting to API-detected currency", async () => {
      setMockOrganization({
        id: "test-org-id",
        name: "Test Org",
        currency: "USD",
      });
      mockDetectCurrency.mockReturnValue({
        data: { currency: "USD" },
        isLoading: false,
      });

      renderSubscriptionPage();

      await waitFor(() => {
        const currencySelector = screen.getByTestId("currency-selector");
        expect(currencySelector).toBeInTheDocument();
        expect(
          within(currencySelector).getByDisplayValue("$ USD"),
        ).toBeInTheDocument();
      });
    });

    it("shows billing period toggle defaulting to Monthly", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("billing-period-toggle")).toBeInTheDocument();
        expect(screen.getByText("Monthly")).toBeInTheDocument();
        expect(screen.getByText("Annually")).toBeInTheDocument();
      });
    });

    it("falls back to detected currency when organization currency is missing", async () => {
      setMockOrganization({
        id: "test-org-id",
        name: "Test Org",
        currency: null,
      });
      mockDetectCurrency.mockReturnValue({
        data: { currency: "USD" },
        isLoading: false,
      });

      renderSubscriptionPage();

      await waitFor(() => {
        const currencySelector = screen.getByTestId("currency-selector");
        expect(
          within(currencySelector).getByDisplayValue("$ USD"),
        ).toBeInTheDocument();
      });
    });

    it("shows Save badge when switching to annually", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      const toggle = screen.getByTestId("billing-period-toggle");
      const switchInput = within(toggle).getByRole("checkbox");
      await user.click(switchInput);

      await waitFor(() => {
        expect(screen.getByText(/Save 8%/i)).toBeInTheDocument();
      });
    });

    it("hides billing controls for paid plans", async () => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "GROWTH",
          name: "Growth",
          free: false,
          maxMembers: 5,
          maxMembersLite: 1000,
          maxMessagesPerMonth: 200000,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });

      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("billing-period-toggle")).not.toBeInTheDocument();
      expect(screen.queryByTestId("currency-selector")).not.toBeInTheDocument();
    });
  });

  describe("when upgrade block shows dynamic pricing", () => {
    it("displays total based on core members count", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      // Add 1 seat via drawer (2 existing core + 1 = 3 total)
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        // 3 Full Members × €29 = €87/mo
        const total = screen.getByTestId("upgrade-total");
        expect(total).toHaveTextContent("€87/mo");
        expect(total).toHaveTextContent("3 seats");
      });
    });

    it("updates price when switching to annually", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      // Add 1 seat
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      // Switch to annual
      const toggle = screen.getByTestId("billing-period-toggle");
      const switchInput = within(toggle).getByRole("checkbox");
      await user.click(switchInput);

      await waitFor(() => {
        // 3 seats × €320/yr = €96,000 cents → "€960/yr"
        const total = screen.getByTestId("upgrade-total");
        expect(total).toHaveTextContent("€960/yr");
      });
    });

    it("calls create subscription API when clicking Upgrade now", async () => {
      const user = userEvent.setup();
      const mockMutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync: mockMutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      // Add 1 seat
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await user.click(screen.getByRole("button", { name: /Upgrade now/i }));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "test-org-id",
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            membersToAdd: 3,
          })
        );
      });
    });
  });

  // ============================================================================
  // Update seats Block (Growth Plan)
  // ============================================================================

  describe("when on Growth plan with planned users", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "GROWTH",
          name: "Growth",
          free: false,
          maxMembers: 2,
          maxMembersLite: 1000,
          maxMessagesPerMonth: 200000,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("shows update-seats-block after adding seats", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });
    });

    it("does not show update-seats-block without planned users", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("update-seats-block")).not.toBeInTheDocument();
    });

    it("opens proration preview modal with correct params when clicking Update subscription", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      // Add 1 seat: maxMembers (2) + 1 planned = 3 total
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Update subscription/i }));

      await waitFor(() => {
        expect(mockOpenSeats).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "test-org-id",
            currentSeats: 2,
            newSeats: 3,
            onConfirm: expect.any(Function),
          })
        );
      });
    });

    it("calls addTeamMemberOrEvents when onConfirm callback is invoked", async () => {
      const user = userEvent.setup();
      const mockMutateAsync = vi.fn().mockResolvedValue({ success: true });
      mockAddTeamMemberOrEvents.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync: mockMutateAsync,
        isLoading: false,
        isPending: false,
      });

      renderSubscriptionPage();

      // Add 1 seat: maxMembers (2) + 1 planned = 3 total
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Update subscription/i }));

      // Extract the onConfirm callback from the openSeats call and invoke it
      const openSeatsCall = mockOpenSeats.mock.calls[0]![0] as { onConfirm: () => Promise<void> };
      await openSeatsCall.onConfirm();

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "test-org-id",
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          upgradeMembers: true,
          upgradeTraces: false,
          totalMembers: 3,
          totalTraces: 0,
        })
      );
    });

    it("hides update-seats-block and resets user count when clicking Discard", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      // Add 1 seat: shows update-seats block
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      // Click Discard
      await user.click(screen.getByTestId("discard-seat-changes-button"));

      // Update seats block should disappear
      await waitFor(() => {
        expect(screen.queryByTestId("update-seats-block")).not.toBeInTheDocument();
      });

      // User count should return to original (2/2)
      expect(screen.getByTestId("user-count-link")).toHaveTextContent("2/2");
    });
  });

  // ============================================================================
  // Update seats with Invites (Growth Plan)
  // ============================================================================

  describe("when on Growth plan and updating seats with invite emails", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "GROWTH",
          name: "Growth",
          free: false,
          maxMembers: 2,
          maxMembersLite: 1000,
          maxMessagesPerMonth: 200000,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("clears planned users after successful seat update via onConfirm", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      // Add a seat with email
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      const emailInput = screen.getByTestId("seat-email-0") as HTMLInputElement;
      await user.type(emailInput, "teammate@example.com");
      await user.click(screen.getByRole("button", { name: /Done/i }));

      // Verify seats were added (3/2)
      await waitFor(() => {
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("3/2");
      });

      await user.click(screen.getByRole("button", { name: /Update subscription/i }));

      // Extract and invoke the onConfirm callback to simulate the modal confirmation
      const openSeatsCall = mockOpenSeats.mock.calls.at(-1)![0] as { onConfirm: () => Promise<void> };
      await openSeatsCall.onConfirm();

      // After successful update, planned users are cleared — count returns to existing members
      await waitFor(() => {
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("2/2");
      });
    });
  });

  // ============================================================================
  // Billing Seat Count Consistency
  // ============================================================================

  describe("when verifying billing seat count consistency", () => {
    describe("when on Free plan with fewer active users than maxSeats", () => {
      beforeEach(() => {
        // 1 active member, maxMembers=2
        mockGetOrganizationWithMembers.mockReturnValue({
          data: {
            ...mockOrganizationMembers,
            members: [mockOrganizationMembers.members[0]!],
          },
          isLoading: false,
          refetch: vi.fn(),
        });
        mockGetActivePlan.mockReturnValue({
          data: createMockPlan({ maxMembers: 2 }),
          isLoading: false,
          refetch: vi.fn(),
        });
      });

      it("does not show upgrade block before planning seats", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });

        expect(screen.queryByTestId("upgrade-plan-block")).not.toBeInTheDocument();
      });

      it("shows 2 Full Members after adding a manual seat in drawer", async () => {
        const user = userEvent.setup();
        renderSubscriptionPage();

        await user.click(screen.getByTestId("user-count-link"));
        await user.click(screen.getByRole("button", { name: /Add Seat/i }));
        await user.click(screen.getByRole("button", { name: /Done/i }));

        await waitFor(() => {
          const total = screen.getByTestId("upgrade-total");
          expect(total).toHaveTextContent("2 seats");
          expect(total).toHaveTextContent("€58/mo");
        });
      });
    });

    describe("when on Free plan at capacity (2/2 members)", () => {
      it("does not show upgrade block without planned seat changes", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });

        expect(screen.queryByTestId("upgrade-plan-block")).not.toBeInTheDocument();
      });
    });

    describe("when on paid plan with pending invites (no double-counting)", () => {
      beforeEach(() => {
        mockGetActivePlan.mockReturnValue({
          data: createMockPlan({
            type: "GROWTH",
            name: "Growth",
            free: false,
            maxMembers: 6,
          }),
          isLoading: false,
          refetch: vi.fn(),
        });
        // 2 pending core invites (already counted in maxMembers)
        mockGetPendingInvites.mockReturnValue({
          data: [
            { id: "inv-1", email: "inv1@example.com", role: "MEMBER", status: "PENDING" },
            { id: "inv-2", email: "inv2@example.com", role: "ADMIN", status: "PENDING" },
          ],
          isLoading: false,
        });
      });

      it("shows correct seat count without double-counting pending invites", async () => {
        const user = userEvent.setup();
        renderSubscriptionPage();

        // Add 1 manual seat
        await user.click(screen.getByTestId("user-count-link"));
        await user.click(screen.getByRole("button", { name: /Add Seat/i }));
        await user.click(screen.getByRole("button", { name: /Done/i }));

        await waitFor(() => {
          expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
        });

        // maxMembers(6) + 1 new manual seat = 7, NOT 6 + 3 (which double-counts pending invites)
        const updateBlock = screen.getByTestId("update-seats-block");
        expect(within(updateBlock).getByText(/7 seats/i)).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // GROWTH_SEAT Plan Type — Billing Interval & Currency from Plan
  // ============================================================================

  describe("when organization has a GROWTH_SEAT_EUR_ANNUAL plan", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "GROWTH_SEAT_EUR_ANNUAL",
          name: "Growth",
          free: false,
          maxMembers: 5,
          maxMembersLite: 9999,
          maxMessagesPerMonth: 200000,
          evaluationsCredit: 9999,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("displays annual price with /yr suffix in plan description", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const currentBlock = screen.getByTestId("current-plan-block");
        expect(within(currentBlock).getByText("Growth plan")).toBeInTheDocument();
        // 5 seats × €320/yr = €1,600/yr
        expect(within(currentBlock).getByText(/€1,600\/yr/)).toBeInTheDocument();
      });
    });

    it("hides billing period toggle and currency selector", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("billing-period-toggle")).not.toBeInTheDocument();
      expect(screen.queryByTestId("currency-selector")).not.toBeInTheDocument();
    });

    it("sends correct plan type in seat update mutation", async () => {
      const user = userEvent.setup();
      const mockMutateAsync = vi.fn().mockResolvedValue({ success: true });
      mockAddTeamMemberOrEvents.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync: mockMutateAsync,
        isLoading: false,
        isPending: false,
      });

      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Update subscription/i }));

      const openSeatsCall = mockOpenSeats.mock.calls.at(-1)![0] as { onConfirm: () => Promise<void> };
      await openSeatsCall.onConfirm();

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "test-org-id",
          plan: "GROWTH_SEAT_EUR_ANNUAL",
          totalMembers: 6,
        })
      );
    });
  });

  describe("when organization has a GROWTH_SEAT_USD_MONTHLY plan", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "GROWTH_SEAT_USD_MONTHLY",
          name: "Growth",
          free: false,
          maxMembers: 3,
          maxMembersLite: 9999,
          maxMessagesPerMonth: 200000,
          evaluationsCredit: 9999,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("displays USD monthly price with /mo suffix in plan description", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const currentBlock = screen.getByTestId("current-plan-block");
        expect(within(currentBlock).getByText("Growth plan")).toBeInTheDocument();
        // 3 seats × $32/mo = $96/mo
        expect(within(currentBlock).getByText(/\$96\/mo/)).toBeInTheDocument();
      });
    });

    it("uses USD currency for update-seats pricing", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        const updateBlock = screen.getByTestId("update-seats-block");
        // maxMembers(3) + 1 planned = 4 seats × $32/mo = $128/mo
        expect(within(updateBlock).getByText(/\$128\/mo/)).toBeInTheDocument();
      });
    });
  });
});
