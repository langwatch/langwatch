/**
 * @vitest-environment jsdom
 *
 * Integration tests for SubscriptionPage — SEAT_EVENT and TIERED pricing
 * models, enterprise TIERED exclusion, and upgrade-from-TIERED flow.
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
  // Pricing Model Behavior
  // ============================================================================

  describe("when organization has specific pricing model", () => {
    describe("when organization uses SEAT_EVENT pricing model", () => {
      beforeEach(() => {
        setMockOrganization({
          id: "test-org-id",
          name: "Test Org",
          pricingModel: "SEAT_EVENT",
        });
      });

      it("renders billing page content on subscription route", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
          expect(screen.getByTestId("contact-sales-block")).toBeInTheDocument();
        });
      });
    });

    describe("when organization uses TIERED pricing model", () => {
      beforeEach(() => {
        setMockOrganization({
          id: "test-org-id",
          name: "Test Org",
          pricingModel: "TIERED",
        });
      });

      it("does not show the old tiered alert on subscription page", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });

        expect(screen.queryByTestId("tiered-pricing-alert")).not.toBeInTheDocument();
      });

      it("hides upgrade plan block on free plan without seat changes", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });

        expect(screen.queryByTestId("upgrade-plan-block")).not.toBeInTheDocument();
      });

      it("shows legacy paid plan name as current plan title", async () => {
        mockGetActivePlan.mockReturnValue({
          data: createMockPlan({
            type: "ACCELERATE",
            name: "Accelerate",
            free: false,
            maxMembers: 5,
            maxMembersLite: 9999,
            maxMessagesPerMonth: 20000,
          }),
          isLoading: false,
          refetch: vi.fn(),
        });

        renderSubscriptionPage();

        await waitFor(() => {
          const currentBlock = screen.getByTestId("current-plan-block");
          expect(within(currentBlock).getByText("Accelerate")).toBeInTheDocument();
        });
      });

      it("hides the update seats block on legacy paid plan with planned users", async () => {
        mockGetActivePlan.mockReturnValue({
          data: createMockPlan({
            type: "ACCELERATE",
            name: "Accelerate",
            free: false,
            maxMembers: 5,
            maxMembersLite: 9999,
            maxMessagesPerMonth: 20000,
          }),
          isLoading: false,
          refetch: vi.fn(),
        });

        const user = userEvent.setup();
        renderSubscriptionPage();

        await user.click(screen.getByTestId("user-count-link"));
        await user.click(screen.getByRole("button", { name: /Add Seat/i }));
        await user.click(screen.getByRole("button", { name: /Done/i }));

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });

        expect(screen.queryByTestId("update-seats-block")).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // TIERED Legacy Paid Org
  // ============================================================================

  describe("when TIERED paid org views subscription page", () => {
    beforeEach(() => {
      setMockOrganization({
        id: "test-org-id",
        name: "Test Org",
        pricingModel: "TIERED",
      });
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "ACCELERATE",
          name: "Accelerate",
          free: false,
          maxMembers: 5,
          maxMembersLite: 9999,
          maxMessagesPerMonth: 20000,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("displays deprecated pricing notice", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("tiered-deprecated-notice")).toBeInTheDocument();
      });
    });

    it("shows legacy tiered capabilities in the current plan block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const currentBlock = screen.getByTestId("current-plan-block");
        expect(within(currentBlock).getByText("Up to 5 core users")).toBeInTheDocument();
        expect(within(currentBlock).getByText("20,000 events included")).toBeInTheDocument();
      });
    });

    it("displays upgrade plan block with Upgrade now button", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const upgradeBlock = screen.getByTestId("upgrade-plan-block");
        expect(within(upgradeBlock).getByRole("button", { name: /Upgrade now/i })).toBeInTheDocument();
      });
    });

    describe("when clicking Upgrade now", () => {
      it("calls createSubscription with resolved GROWTH_SEAT plan", async () => {
        const user = userEvent.setup();
        const mockMutateAsync = vi.fn().mockResolvedValue({ url: null });
        mockCreateSubscription.mockReturnValue({
          mutate: vi.fn(),
          mutateAsync: mockMutateAsync,
          isLoading: false,
          isPending: false,
        });

        renderSubscriptionPage();

        await waitFor(() => {
          expect(screen.getByTestId("upgrade-plan-block")).toBeInTheDocument();
        });

        await user.click(screen.getByRole("button", { name: /Upgrade now/i }));

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({
              organizationId: "test-org-id",
              plan: "GROWTH_SEAT_EUR_MONTHLY",
            }),
          );
        });
      });
    });
  });

  // ============================================================================
  // ENTERPRISE TIERED Org (Exclusion)
  // ============================================================================

  describe("when ENTERPRISE TIERED org views subscription page", () => {
    beforeEach(() => {
      setMockOrganization({
        id: "test-org-id",
        name: "Test Org",
        pricingModel: "TIERED",
      });
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "ENTERPRISE",
          name: "Enterprise",
          free: false,
          maxMembers: 100,
          maxMembersLite: 9999,
          maxMessagesPerMonth: 1000000,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("does not display deprecated pricing notice", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("tiered-deprecated-notice")).not.toBeInTheDocument();
    });

    it("does not display upgrade plan block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("upgrade-plan-block")).not.toBeInTheDocument();
    });
  });
});
