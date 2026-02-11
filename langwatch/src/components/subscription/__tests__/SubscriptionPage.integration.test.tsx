/**
 * @vitest-environment jsdom
 *
 * Integration tests for the SubscriptionPage component.
 * Tests scenarios from specs/licensing/subscription-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { SubscriptionPage } from "../SubscriptionPage";

// Mock dependencies
const mockRouterReplace = vi.fn();
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockRouterReplace,
    query: {},
    asPath: "/settings/subscription",
  }),
}));

let mockOrganization: { id: string; name: string; pricingModel?: string } = {
  id: "test-org-id",
  name: "Test Org",
};
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", slug: "test-project" },
    organization: mockOrganization,
    team: { id: "test-team-id" },
  }),
}));

// Mock SettingsLayout to avoid complex dependency chain
vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

// Mock plan data
const createMockPlan = (overrides: Partial<PlanInfo> = {}): PlanInfo => ({
  type: "FREE",
  name: "Developer",
  free: true,
  maxMembers: 2,
  maxMembersLite: 0,
  maxTeams: 1,
  maxProjects: 3,
  maxMessagesPerMonth: 50000,
  evaluationsCredit: 3,
  maxWorkflows: 3,
  maxPrompts: 3,
  maxEvaluators: 3,
  maxScenarios: 3,
  maxAgents: 3,
  maxExperiments: 3,
  maxOnlineEvaluations: 3,
  maxDatasets: 3,
  maxDashboards: 3,
  maxCustomGraphs: 3,
  maxAutomations: 3,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
  ...overrides,
});

// Mock organization members data (matches the shape returned by getOrganizationWithMembersAndTheirTeams)
const mockOrganizationMembers = {
  id: "test-org-id",
  name: "Test Org",
  members: [
    {
      userId: "user-1",
      role: "ADMIN",
      user: {
        id: "user-1",
        name: "Admin User",
        email: "admin@example.com",
        teamMemberships: [],
      },
    },
    {
      userId: "user-2",
      role: "MEMBER",
      user: {
        id: "user-2",
        name: "Jane Doe",
        email: "jane@example.com",
        teamMemberships: [],
      },
    },
  ],
};

// Mock API
const mockGetActivePlan = vi.fn(() => ({
  data: createMockPlan(),
  isLoading: false,
}));

const mockGetOrganizationWithMembers = vi.fn(() => ({
  data: mockOrganizationMembers,
  isLoading: false,
  refetch: vi.fn(),
}));

const mockUpdateUsers = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isLoading: false,
}));

const mockCreateSubscription = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ url: null }),
  isLoading: false,
  isPending: false,
}));

const mockAddTeamMemberOrEvents = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ success: true }),
  isLoading: false,
  isPending: false,
}));

const mockManageSubscription = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/session/test" }),
  isLoading: false,
  isPending: false,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));


vi.mock("~/utils/api", () => ({
  api: {
    plan: {
      getActivePlan: {
        useQuery: () => mockGetActivePlan(),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => mockGetOrganizationWithMembers(),
      },
    },
    subscription: {
      updateUsers: {
        useMutation: () => mockUpdateUsers(),
      },
      create: {
        useMutation: () => mockCreateSubscription(),
      },
      addTeamMemberOrEvents: {
        useMutation: () => mockAddTeamMemberOrEvents(),
      },
      manage: {
        useMutation: () => mockManageSubscription(),
      },
    },
    useContext: vi.fn(() => ({
      organization: {
        getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() },
      },
    })),
  },
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderSubscriptionPage = () => {
  return render(<SubscriptionPage />, { wrapper: Wrapper });
};

describe("<SubscriptionPage/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganization = {
      id: "test-org-id",
      name: "Test Org",
    };
    mockRouterReplace.mockReset();
    mockGetActivePlan.mockReturnValue({
      data: createMockPlan(),
      isLoading: false,
    });
    mockGetOrganizationWithMembers.mockReturnValue({
      data: mockOrganizationMembers,
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ============================================================================
  // Page Layout
  // ============================================================================

  describe("when the subscription page loads", () => {
    it("displays current plan block and upgrade plan block", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        expect(screen.getByTestId("upgrade-plan-block")).toBeInTheDocument();
      });
    });

    it("displays a contact link for billing questions", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText(/contact us/i)).toBeInTheDocument();
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
        expect(within(currentBlock).getByText(/2 core members/i)).toBeInTheDocument();
        expect(within(currentBlock).getByText(/Community support/i)).toBeInTheDocument();
      });
    });

    it("shows the upgrade block with Growth features", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const upgradeBlock = screen.getByTestId("upgrade-plan-block");
        expect(within(upgradeBlock).getByText(/Growth Plan/i)).toBeInTheDocument();
        expect(within(upgradeBlock).getByRole("button", { name: /Upgrade now/i })).toBeInTheDocument();
      });
    });

    it("displays the user count as a clickable link", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const userCountLink = screen.getByTestId("user-count-link");
        expect(userCountLink).toBeInTheDocument();
        expect(userCountLink).toHaveTextContent("2");
      });
    });
  });

  // ============================================================================
  // Plan Display - Growth Tier
  // ============================================================================

  describe("when viewing the upgrade plan block", () => {
    it("shows correct Growth plan features", async () => {
      renderSubscriptionPage();

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
      renderSubscriptionPage();

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
  // User Management Drawer
  // ============================================================================

  describe("when clicking on the user count in the plan block", () => {
    it("opens a drawer showing 'Manage Seats'", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("user-count-link")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByText("Manage Seats")).toBeInTheDocument();
      });
    });

    it("shows Current Members and Pending Seats sections", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByText("Current Members")).toBeInTheDocument();
        expect(screen.getByText("Pending Seats")).toBeInTheDocument();
      });
    });

    it("shows a list of organization users", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByText("Admin User")).toBeInTheDocument();
        expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      });
    });
  });

  describe("when viewing the seat management drawer", () => {
    it("shows member type badge for each user", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        // Both users are Core Users (ADMIN and MEMBER roles map to core)
        const coreUserBadges = screen.getAllByText("Core User");
        expect(coreUserBadges.length).toBeGreaterThanOrEqual(2);
      });
    });

  });

  // ============================================================================
  // Adding Seats
  // ============================================================================

  describe("when clicking 'Add Seat' in the drawer", () => {
    it("adds a pending seat row with email input immediately", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Add Seat/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-0")).toBeInTheDocument();
        expect(screen.getByTestId("seat-email-0")).toBeInTheDocument();
      });
    });

    it("allows entering an email for a pending seat", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Add Seat/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      const emailInput = screen.getByTestId("seat-email-0") as HTMLInputElement;
      await user.type(emailInput, "newuser@example.com");

      expect(emailInput.value).toBe("newuser@example.com");
    });

    it("defaults member type to Full Member", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      await waitFor(() => {
        const selectRoot = screen.getByTestId("seat-member-type-0");
        // The Chakra Select renders a value text span showing the selected label
        const valueText = within(selectRoot).getByText("Full Member", { selector: "span" });
        expect(valueText).toBeInTheDocument();
      });
    });

    it("renders both Full Member and Lite Member options", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      // The Chakra Select renders a hidden native <select> with both options
      const selectRoot = screen.getByTestId("seat-member-type-0");
      const nativeSelect = selectRoot.querySelector("select") as HTMLSelectElement;
      expect(nativeSelect).toBeInTheDocument();

      const options = Array.from(nativeSelect.options).map((o) => o.textContent);
      expect(options).toContain("Full Member");
      expect(options).toContain("Lite Member");
    });

    it("adds multiple seats when clicked multiple times", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Add Seat/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-0")).toBeInTheDocument();
        expect(screen.getByTestId("pending-seat-1")).toBeInTheDocument();
        expect(screen.getByTestId("pending-seat-2")).toBeInTheDocument();
      });
    });

    it("allows removing individual pending seats", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Add Seat/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-2")).toBeInTheDocument();
      });

      // Remove the second pending seat using its data-testid
      await user.click(screen.getByTestId("remove-seat-1"));

      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-0")).toBeInTheDocument();
        expect(screen.getByTestId("pending-seat-1")).toBeInTheDocument();
        expect(screen.queryByTestId("pending-seat-2")).not.toBeInTheDocument();
      });
    });
  });

  describe("when closing the drawer with Done after adding seats", () => {
    it("reflects batch-added seats in total user count", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Add Seat/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      // Click Done to save
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        // 2 existing users + 3 new seats = 5
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("5");
      });
    });

    it("preserves batch-added seats when reopening drawer", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Add Seat/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      // Click Done to save
      await user.click(screen.getByRole("button", { name: /Done/i }));

      // Reopen drawer
      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-0")).toBeInTheDocument();
        expect(screen.getByTestId("pending-seat-1")).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Discarding Changes
  // ============================================================================

  describe("when clicking Cancel after adding seats", () => {
    it("closes the drawer and discards batch-added seats", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByText("Manage Seats")).toBeInTheDocument();
      });

      // Add some seats
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      // Click Cancel
      await user.click(screen.getByRole("button", { name: /Cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText("Manage Seats")).not.toBeInTheDocument();
      });

      // Reopen - pending seats should be gone
      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.queryByTestId("pending-seat-0")).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Billing Toggles and Dynamic Pricing
  // ============================================================================

  describe("when viewing billing toggles", () => {
    it("shows currency selector defaulting to EUR", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        const currencySelector = screen.getByTestId("currency-selector");
        expect(currencySelector).toBeInTheDocument();
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

    it("shows Save badge when switching to annually", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      const toggle = screen.getByTestId("billing-period-toggle");
      const switchInput = within(toggle).getByRole("checkbox");
      await user.click(switchInput);

      await waitFor(() => {
        expect(screen.getByText(/Save 8%/i)).toBeInTheDocument();
      });
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
        // 3 core members × €29 = €87/mo
        const total = screen.getByTestId("upgrade-total");
        expect(total).toHaveTextContent("€87/mo");
        expect(total).toHaveTextContent("3 core members");
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
        // 3 x €27 (Math.round(29 * 0.92)) = €81/mo
        const total = screen.getByTestId("upgrade-total");
        expect(total).toHaveTextContent("€81/mo");
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
            plan: "GROWTH_SEAT_USAGE",
            membersToAdd: 3,
          })
        );
      });
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
  // Update Seats Block (Growth Plan)
  // ============================================================================

  describe("when on Growth plan with planned users", () => {
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

    it("calls addTeamMemberOrEvents with correct args when clicking Update subscription", async () => {
      const user = userEvent.setup();
      const mockMutateAsync = vi.fn().mockResolvedValue({ success: true });
      mockAddTeamMemberOrEvents.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync: mockMutateAsync,
        isLoading: false,
        isPending: false,
      });

      renderSubscriptionPage();

      // Add 1 seat (2 existing core + 1 = 3 total)
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Update subscription/i }));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "test-org-id",
            plan: "GROWTH_SEAT_USAGE",
            upgradeMembers: true,
            upgradeTraces: false,
            totalMembers: 3,
            totalTraces: 0,
          })
        );
      });
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
          maxMembers: 20,
          maxMembersLite: 1000,
          maxMessagesPerMonth: 200000,
        }),
        isLoading: false,
      });
    });

    it("does not show Upgrade required badge", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      expect(screen.queryByText(/Upgrade required/i)).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Pricing Model Routing
  // ============================================================================

  describe("when organization has specific pricing model", () => {
    describe("when organization uses SEAT_USAGE pricing model", () => {
      beforeEach(() => {
        mockOrganization = {
          id: "test-org-id",
          name: "Test Org",
          pricingModel: "SEAT_USAGE",
        };
      });

      it("redirects to the billing page", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          expect(mockRouterReplace).toHaveBeenCalledWith("/settings/billing");
        });
      });
    });

    describe("when organization uses TIERED pricing model", () => {
      beforeEach(() => {
        mockOrganization = {
          id: "test-org-id",
          name: "Test Org",
          pricingModel: "TIERED",
        };
      });

      it("shows an alert suggesting to upgrade to the new pricing model", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          const alert = screen.getByTestId("tiered-pricing-alert");
          expect(alert).toBeInTheDocument();
          expect(alert).toHaveTextContent(/updated our pricing model/i);
        });

        const link = screen.getByRole("link", { name: /plans page/i });
        expect(link).toHaveAttribute("href", "/settings/plans");
      });

      it("hides the upgrade plan block on free plan", async () => {
        renderSubscriptionPage();

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });

        expect(
          screen.queryByTestId("upgrade-plan-block")
        ).not.toBeInTheDocument();
      });

      it("hides the update seats block on growth plan with planned users", async () => {
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
        });

        const user = userEvent.setup();
        renderSubscriptionPage();

        await user.click(screen.getByTestId("user-count-link"));
        await user.click(screen.getByRole("button", { name: /Add Seat/i }));
        await user.click(screen.getByRole("button", { name: /Done/i }));

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });

        expect(
          screen.queryByTestId("update-seats-block")
        ).not.toBeInTheDocument();
      });
    });
  });
});
