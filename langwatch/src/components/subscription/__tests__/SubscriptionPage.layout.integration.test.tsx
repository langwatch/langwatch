/**
 * @vitest-environment jsdom
 *
 * Integration tests for SubscriptionPage — page layout, plan display,
 * loading states, success redirect, pending invites, and badge behaviour.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPage } from "../SubscriptionPage";
import { ENTERPRISE_PLAN_FEATURES } from "../billing-plans";
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
  // Page Layout
  // ============================================================================

  describe("when the subscription page loads", () => {
    it("displays current plan block and hides upgrade plan block by default", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        expect(screen.queryByTestId("upgrade-plan-block")).not.toBeInTheDocument();
      });
    });

    it("displays a contact link for billing questions", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText(/contact us/i)).toBeInTheDocument();
      });
    });

    it("shows enterprise features in the contact sales block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const enterpriseFeatures = screen.getByTestId("enterprise-features-list");
        expect(
          within(enterpriseFeatures).getByText(ENTERPRISE_PLAN_FEATURES[0]!),
        ).toBeInTheDocument();
        expect(
          within(enterpriseFeatures).getByText(
            ENTERPRISE_PLAN_FEATURES[ENTERPRISE_PLAN_FEATURES.length - 1]!,
          ),
        ).toBeInTheDocument();
      });
    });

    it("renders feature grid for current plan block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-features-grid")).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Plan Display - Developer (Free) Tier
  // ============================================================================

  describe("when organization has no active paid subscription", () => {
    it("shows 'Current' badge on the current plan block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const currentBlock = screen.getByTestId("current-plan-block");
        expect(within(currentBlock).getByText("Current")).toBeInTheDocument();
      });
    });

    it("shows the Free plan label and developer features", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const currentBlock = screen.getByTestId("current-plan-block");

        // Title
        expect(within(currentBlock).getByText("Free plan")).toBeInTheDocument();

        // Features
        expect(within(currentBlock).getByText(/2 users/i)).toBeInTheDocument();
        expect(within(currentBlock).getByText(/Community support/i)).toBeInTheDocument();
      });
    });

    it("hides the upgrade block before seat changes", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("upgrade-plan-block")).not.toBeInTheDocument();
    });

    it("displays the user count as N/M format", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const userCountLink = screen.getByTestId("user-count-link");
        expect(userCountLink).toBeInTheDocument();
        expect(userCountLink).toHaveTextContent("2/2");
      });
    });
  });

  // ============================================================================
  // Plan Display - Growth Tier
  // ============================================================================

  describe("when viewing the upgrade plan block", () => {
    it("shows correct Growth plan features", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        const upgradeBlock = screen.getByTestId("upgrade-plan-block");

        // Features
        expect(within(upgradeBlock).getByText(/200,000.*events/i)).toBeInTheDocument();
        expect(within(upgradeBlock).getByText(/30 days.*retention/i)).toBeInTheDocument();
        expect(within(upgradeBlock).getByText(/20.*core users/i)).toBeInTheDocument();
        expect(within(upgradeBlock).getByText(/Unlimited.*lite users/i)).toBeInTheDocument();
        expect(within(upgradeBlock).getByText(/Unlimited.*evals/i)).toBeInTheDocument();
        expect(within(upgradeBlock).getByText(/Private Slack/i)).toBeInTheDocument();
      });
    });

    it("shows 'Upgrade now' button on upgrade block", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        const upgradeBlock = screen.getByTestId("upgrade-plan-block");
        expect(within(upgradeBlock).getByRole("button", { name: /Upgrade now/i })).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Growth Plan as Current
  // ============================================================================

  describe("when organization has an active Growth subscription", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "GROWTH",
          name: "Growth",
          free: false,
          maxMembers: 20,
          maxMembersLite: 1000,
          maxMessagesPerMonth: 200000,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("shows 'Current' badge on the Growth plan block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const currentBlock = screen.getByTestId("current-plan-block");
        expect(within(currentBlock).getByText("Current")).toBeInTheDocument();
        expect(within(currentBlock).getByText("Growth plan")).toBeInTheDocument();
      });
    });

    it("does not show the upgrade block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("upgrade-plan-block")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Saving - Pending State Flow
  // ============================================================================

  describe("when adding seats beyond the plan limit", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({ maxMembers: 2 }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("shows upgrade required badge after adding seats and clicking Done", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      // Add a third seat (exceeds limit of 2)
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      // Click Done
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByText(/Upgrade required/i)).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Loading States
  // ============================================================================

  describe("when user data is being fetched", () => {
    it("shows a loading spinner", async () => {
      const user = userEvent.setup();
      mockGetOrganizationWithMembers.mockReturnValue({
        data: { ...mockOrganizationMembers, members: [] },
        isLoading: true,
        refetch: vi.fn(),
      });

      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Drawer does not display alert banners
  // ============================================================================

  describe("when opening the seat management drawer", () => {
    it("does not display alert banners", async () => {
      const user = userEvent.setup();

      // Set up org with single admin to previously trigger the alert
      const adminMember = mockOrganizationMembers.members[0]!;
      mockGetOrganizationWithMembers.mockReturnValue({
        data: { ...mockOrganizationMembers, members: [adminMember] },
        isLoading: false,
        refetch: vi.fn(),
      });

      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByText("Manage Seats")).toBeInTheDocument();
      });

      // No admin-requires-core-user info banner
      expect(screen.queryByText(/admin.*requires.*core/i)).not.toBeInTheDocument();
      // No exceeded-limit warning banner
      expect(screen.queryByText(/exceeded.*user limit/i)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Manage Subscription Button
  // ============================================================================

  describe("when on Growth plan", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          type: "GROWTH",
          name: "Growth",
          free: false,
          maxMembers: 20,
          maxMembersLite: 1000,
          maxMessagesPerMonth: 200000,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
    });

    it("shows Manage Subscription button", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("manage-subscription-button")).toBeInTheDocument();
      });
    });
  });

  describe("when on Free plan", () => {
    it("does not show Manage Subscription button", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("manage-subscription-button")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Upgrade Required Badge
  // ============================================================================

  describe("when on Growth plan and adding seats", () => {
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

    it("shows Upgrade required badge", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      expect(screen.getByText(/Upgrade required/i)).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Upgrade Credit Notice
  // ============================================================================

  describe("when URL contains success and upgraded_from params", () => {
    beforeEach(() => {
      window.history.pushState({}, "", "?success&upgraded_from=tiered");
    });

    afterEach(() => {
      window.history.pushState({}, "", "/");
    });

    it("displays the upgrade credit notice", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("credit-notice")).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // N/M Seat Display with Pending Invites
  // ============================================================================

  describe("when organization has pending invites", () => {
    beforeEach(() => {
      mockGetPendingInvites.mockReturnValue({
        data: [
          { role: "MEMBER", status: "PENDING" },
          { role: "ADMIN", status: "PENDING" },
          { role: "EXTERNAL", status: "PENDING" },
        ],
        isLoading: false,
      });
    });

    it("includes core PENDING invites in N count", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        // 2 core members + 2 core PENDING invites (MEMBER + ADMIN) = 4, maxMembers = 2
        const userCountLink = screen.getByTestId("user-count-link");
        expect(userCountLink).toHaveTextContent("4/2");
      });
    });

    it("excludes EXTERNAL invites from N count", async () => {
      mockGetPendingInvites.mockReturnValue({
        data: [
          { role: "EXTERNAL", status: "PENDING" },
        ],
        isLoading: false,
      });

      renderSubscriptionPage();

      await waitFor(() => {
        // 2 core members + 0 core pending = 2, maxMembers = 2
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("2/2");
      });
    });
  });
});
