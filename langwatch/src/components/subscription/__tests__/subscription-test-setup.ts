/**
 * Shared setup for SubscriptionPage integration tests.
 *
 * Exports mock factories, mock function references, and a resetMocks()
 * helper that each test file calls in its own beforeEach.
 *
 * NOTE: vi.mock() calls are hoisted by vitest and must live at the
 * top level of each test file — they cannot be shared from here.
 * This module only exports data, factories, and imperative helpers.
 *
 * The render helper (renderSubscriptionPage) lives in each test file
 * because it requires JSX, which needs a .tsx extension.
 */
import { vi } from "vitest";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";

// ---------------------------------------------------------------------------
// Mutable mock organisation (reset per-test via resetMocks)
// ---------------------------------------------------------------------------
export let mockOrganization: {
  id: string;
  name: string;
  pricingModel?: string;
  currency?: "EUR" | "USD" | null;
} = {
  id: "test-org-id",
  name: "Test Org",
  currency: "EUR",
};

export function setMockOrganization(value: typeof mockOrganization) {
  mockOrganization = value;
}

// ---------------------------------------------------------------------------
// Plan factory
// ---------------------------------------------------------------------------
export const createMockPlan = (overrides: Partial<PlanInfo> = {}): PlanInfo => ({
  planSource: "free",
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

// ---------------------------------------------------------------------------
// Organisation members fixture
// ---------------------------------------------------------------------------
export const mockOrganizationMembers = {
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

// ---------------------------------------------------------------------------
// Mock API functions (shared references used by vi.mock in each test file)
// ---------------------------------------------------------------------------
export const mockGetActivePlan = vi.fn(() => ({
  data: createMockPlan(),
  isLoading: false,
  refetch: vi.fn(),
}));

export const mockGetOrganizationWithMembers = vi.fn(() => ({
  data: mockOrganizationMembers,
  isLoading: false,
  refetch: vi.fn(),
}));

export const mockUpdateUsers = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isLoading: false,
}));

export const mockCreateSubscription = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ url: null }),
  isLoading: false,
  isPending: false,
}));

export const mockAddTeamMemberOrEvents = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ success: true }),
  isLoading: false,
  isPending: false,
}));

export const mockManageSubscription = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/session/test" }),
  isLoading: false,
  isPending: false,
}));

export const mockUpgradeWithInvites = vi.fn(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({ url: null }),
  isLoading: false,
  isPending: false,
}));

export const mockGetPendingInvites = vi.fn(() => ({
  data: [] as Array<{ id?: string; email?: string; role: string; status: string }>,
  isLoading: false,
}));

export const mockDetectCurrency = vi.fn(() => ({
  data: { currency: "EUR" as "EUR" | "USD" },
  isLoading: false,
}));

export const mockCreateInvitesMutate = vi.fn();
export const mockCreateInvites = vi.fn(() => ({
  mutate: mockCreateInvitesMutate,
  mutateAsync: vi.fn().mockResolvedValue({ success: true }),
  isLoading: false,
  isPending: false,
}));

export const mockOpenSeats = vi.fn();

// ---------------------------------------------------------------------------
// resetMocks — call in every test file's beforeEach
// ---------------------------------------------------------------------------
export function resetMocks() {
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
}

