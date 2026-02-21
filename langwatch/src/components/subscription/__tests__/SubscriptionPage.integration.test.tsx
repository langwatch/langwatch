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
import { ENTERPRISE_PLAN_FEATURES } from "../billing-plans";

let mockOrganization: {
  id: string;
  name: string;
  pricingModel?: string;
  currency?: "EUR" | "USD" | null;
} = {
  id: "test-org-id",
  name: "Test Org",
  currency: "EUR",
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
  refetch: vi.fn(),
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

const mockUpgradeWithInvites = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ url: null }),
  isLoading: false,
  isPending: false,
}));

const mockGetPendingInvites = vi.fn(() => ({
  data: [] as Array<{ id?: string; email?: string; role: string; status: string }>,
  isLoading: false,
}));

const mockDetectCurrency = vi.fn(() => ({
  data: { currency: "EUR" as "EUR" | "USD" },
  isLoading: false,
}));

const mockCreateInvitesMutate = vi.fn();
const mockCreateInvites = vi.fn(() => ({
  mutate: mockCreateInvitesMutate,
  mutateAsync: vi.fn().mockResolvedValue({ success: true }),
  isLoading: false,
  isPending: false,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const mockOpenSeats = vi.fn();
vi.mock("../../../stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: (state: { openSeats: typeof mockOpenSeats }) => unknown) =>
    selector({ openSeats: mockOpenSeats }),
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
      getOrganizationPendingInvites: {
        useQuery: () => ({ ...mockGetPendingInvites(), refetch: vi.fn() }),
      },
      createInvites: {
        useMutation: () => mockCreateInvites(),
      },
    },
    currency: {
      detectCurrency: {
        useQuery: (_input: Record<string, never>, opts: { enabled: boolean }) =>
          opts.enabled ? mockDetectCurrency() : { data: undefined },
      },
    },
    subscription: {
      updateUsers: {
        useMutation: () => mockUpdateUsers(),
      },
      create: {
        useMutation: () => mockCreateSubscription(),
      },
      upgradeWithInvites: {
        useMutation: () => mockUpgradeWithInvites(),
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
      currency: "EUR",
    };
    mockGetActivePlan.mockReturnValue({
      data: createMockPlan(),
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetOrganizationWithMembers.mockReturnValue({
      data: mockOrganizationMembers,
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetPendingInvites.mockReturnValue({
      data: [],
      isLoading: false,
    });
    mockDetectCurrency.mockReturnValue({
      data: { currency: "EUR" },
      isLoading: false,
    });
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

    it("shows collapsible members button and Seats available sections", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Show members/i })).toBeInTheDocument();
        expect(screen.getByText("Seats available")).toBeInTheDocument();
      });
    });

    it("shows a list of organization users by email", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByText("admin@example.com")).toBeInTheDocument();
        expect(screen.getByText("jane@example.com")).toBeInTheDocument();
      });
    });
  });

  describe("when viewing the seat management drawer", () => {
    it("shows member type badge for each user", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        // Both users are Full Members (ADMIN and MEMBER roles map to FullMember)
        const fullMemberBadges = screen.getAllByText("Full Member");
        expect(fullMemberBadges.length).toBeGreaterThanOrEqual(2);
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

    it("shows Full Member badge for new seat", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      await waitFor(() => {
        const badge = screen.getByTestId("seat-member-type-0");
        expect(badge).toHaveTextContent("Full Member");
      });
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
    it("reflects batch-added seats in total user count (N/M format)", async () => {
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
        // 2 existing core + 3 new core seats = 5, max = 2 → "5/2"
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("5/2");
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
    it("shows currency selector defaulting to organization currency", async () => {
      mockOrganization = {
        id: "test-org-id",
        name: "Test Org",
        currency: "USD",
      };

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
      mockOrganization = {
        id: "test-org-id",
        name: "Test Org",
        currency: null,
      };
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
        expect(total).toHaveTextContent("3 Full Members");
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
            plan: "GROWTH_SEAT_EVENT",
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
          plan: "GROWTH_SEAT_EVENT",
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
  // Pricing Model Behavior
  // ============================================================================

  describe("when organization has specific pricing model", () => {
    describe("when organization uses SEAT_EVENT pricing model", () => {
      beforeEach(() => {
        mockOrganization = {
          id: "test-org-id",
          name: "Test Org",
          pricingModel: "SEAT_EVENT",
        };
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
        mockOrganization = {
          id: "test-org-id",
          name: "Test Org",
          pricingModel: "TIERED",
        };
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
      mockOrganization = {
        id: "test-org-id",
        name: "Test Org",
        pricingModel: "TIERED",
      };
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
      it("calls createSubscription with GROWTH_SEAT_EVENT plan", async () => {
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
              plan: "GROWTH_SEAT_EVENT",
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
      mockOrganization = {
        id: "test-org-id",
        name: "Test Org",
        pricingModel: "TIERED",
      };
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
  // Upgrade with Invites
  // ============================================================================

  // ============================================================================
  // Drawer Auto-Fill for Available Seats
  // ============================================================================

  describe("when opening drawer on Growth plan with available seats", () => {
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
    });

    it("shows empty seat rows for each unused FullMember slot", async () => {
      // 2 active FullMembers, 6 maxMembers → 4 auto-filled rows
      const user = userEvent.setup();
      renderSubscriptionPage();
      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-0")).toBeInTheDocument();
        expect(screen.getByTestId("pending-seat-3")).toBeInTheDocument();
        expect(screen.queryByTestId("pending-seat-4")).not.toBeInTheDocument();
      });
    });

    describe("when organization also has pending core invites", () => {
      beforeEach(() => {
        mockGetPendingInvites.mockReturnValue({
          data: [
            { id: "inv-1", email: "inv1@example.com", role: "MEMBER", status: "PENDING" },
            { id: "inv-2", email: "inv2@example.com", role: "ADMIN", status: "PENDING" },
          ],
          isLoading: false,
        });
      });

      it("reduces available rows by pending invite count", async () => {
        // 2 active + 2 pending = 4 occupied, 6 max → 2 auto-filled
        const user = userEvent.setup();
        renderSubscriptionPage();
        await user.click(screen.getByTestId("user-count-link"));

        await waitFor(() => {
          expect(screen.getByTestId("pending-seat-0")).toBeInTheDocument();
          expect(screen.getByTestId("pending-seat-1")).toBeInTheDocument();
          expect(screen.queryByTestId("pending-seat-2")).not.toBeInTheDocument();
        });
      });
    });

    describe("when closing drawer without entering emails", () => {
      it("does not show update-seats block", async () => {
        const user = userEvent.setup();
        renderSubscriptionPage();
        await user.click(screen.getByTestId("user-count-link"));
        await user.click(screen.getByRole("button", { name: /Done/i }));

        await waitFor(() => {
          expect(screen.getByTestId("current-plan-block")).toBeInTheDocument();
        });
        expect(screen.queryByTestId("update-seats-block")).not.toBeInTheDocument();
      });
    });

    describe("when entering email in an available seat row", () => {
      it("sends invite via createInvites without changing subscription", async () => {
        const user = userEvent.setup();
        renderSubscriptionPage();
        await user.click(screen.getByTestId("user-count-link"));

        const emailInput = screen.getByTestId("seat-email-0") as HTMLInputElement;
        await user.type(emailInput, "newuser@example.com");
        await user.click(screen.getByRole("button", { name: /Done/i }));

        await waitFor(() => {
          // Invite sent via createInvites (not subscription change)
          expect(mockCreateInvitesMutate).toHaveBeenCalledWith(
            expect.objectContaining({
              organizationId: "test-org-id",
              invites: expect.arrayContaining([
                expect.objectContaining({ email: "newuser@example.com" }),
              ]),
            }),
            expect.anything(),
          );
        });

        // No update-seats block should appear (invite only, no billing change)
        expect(screen.queryByTestId("update-seats-block")).not.toBeInTheDocument();
      });
    });

    describe("when manually adding a seat via Add Seat button", () => {
      it("saves the manual row even without an email", async () => {
        const user = userEvent.setup();
        renderSubscriptionPage();
        await user.click(screen.getByTestId("user-count-link"));

        // Scroll past auto-filled rows, click Add Seat
        await user.click(screen.getByRole("button", { name: /Add Seat/i }));
        await user.click(screen.getByRole("button", { name: /Done/i }));

        await waitFor(() => {
          expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
        });
      });
    });
  });

  describe("when opening drawer on Free plan at capacity", () => {
    it("shows no available seat rows", async () => {
      // Default: Free plan, maxMembers: 2, 2 active members → 0 auto-fill
      const user = userEvent.setup();
      renderSubscriptionPage();
      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByText("Manage Seats")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("pending-seat-0")).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Upgrade with Invites
  // ============================================================================

  describe("when upgrading with invites containing emails", () => {
    it("calls upgradeWithInvites mutation with invite data", async () => {
      const user = userEvent.setup();
      const mockMutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockUpgradeWithInvites.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync: mockMutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      // Add a seat with email via "Add Seat" button (manual row, not auto-fill)
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));
      const emailInput = screen.getByTestId("seat-email-0") as HTMLInputElement;
      await user.type(emailInput, "new@example.com");
      await user.click(screen.getByRole("button", { name: /Done/i }));

      await user.click(screen.getByRole("button", { name: /Upgrade now/i }));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "test-org-id",
            totalSeats: 3,
            invites: expect.arrayContaining([
              expect.objectContaining({
                email: "new@example.com",
                role: "MEMBER",
              }),
            ]),
          })
        );
      });
    });
  });

  // ============================================================================
  // Invite vs Seat Change Separation (Growth Plan)
  // ============================================================================

  describe("when on Growth plan separating invites from seat changes", () => {
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
    });

    it("deleting an auto-filled empty row shows subscription downgrade option", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();
      await user.click(screen.getByTestId("user-count-link"));

      // 2 active members, 6 max → 4 auto-fill rows (indices 0-3)
      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-3")).toBeInTheDocument();
      });

      // Delete one auto-fill row
      await user.click(screen.getByTestId("remove-seat-0"));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      // Should show update-seats block for downgrade (6 → 5)
      await waitFor(() => {
        expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
      });

      // No invite should be sent (no emails filled)
      expect(mockCreateInvitesMutate).not.toHaveBeenCalled();
    });

    it("does not call createInvites when no changes are made", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();
      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      expect(mockCreateInvitesMutate).not.toHaveBeenCalled();
      expect(screen.queryByTestId("update-seats-block")).not.toBeInTheDocument();
    });

    it("sends invite and shows downgrade when filling email and deleting a row", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();
      await user.click(screen.getByTestId("user-count-link"));

      await waitFor(() => {
        expect(screen.getByTestId("pending-seat-3")).toBeInTheDocument();
      });

      // Fill email in first auto-fill row
      const emailInput = screen.getByTestId("seat-email-0") as HTMLInputElement;
      await user.type(emailInput, "invite@example.com");

      // Delete a different auto-fill row
      await user.click(screen.getByTestId("remove-seat-1"));
      await user.click(screen.getByRole("button", { name: /Done/i }));

      // Invite should be sent
      await waitFor(() => {
        expect(mockCreateInvitesMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "test-org-id",
            invites: expect.arrayContaining([
              expect.objectContaining({ email: "invite@example.com" }),
            ]),
          }),
          expect.anything(),
        );
      });

      // Should also show update-seats block for the deleted row
      expect(screen.getByTestId("update-seats-block")).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Free Plan: Auto-fill email does not send invite
  // ============================================================================

  describe("when on Free plan filling seat via Add Seat", () => {
    it("does not call createInvites and saves as planned user for upgrade", async () => {
      const user = userEvent.setup();
      renderSubscriptionPage();

      await user.click(screen.getByTestId("user-count-link"));
      await user.click(screen.getByRole("button", { name: /Add Seat/i }));

      const emailInput = screen.getByTestId("seat-email-0") as HTMLInputElement;
      await user.type(emailInput, "freeuser@example.com");
      await user.click(screen.getByRole("button", { name: /Done/i }));

      // No invite — free plan users go through upgrade flow
      expect(mockCreateInvitesMutate).not.toHaveBeenCalled();

      // Should show upgrade required
      await waitFor(() => {
        expect(screen.getByText(/Upgrade required/i)).toBeInTheDocument();
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
          expect(total).toHaveTextContent("2 Full Members");
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
        expect(within(updateBlock).getByText(/7 Full Members/i)).toBeInTheDocument();
      });
    });
  });
});
