import type { BillingDisplayInvoice as DisplayInvoice } from "@langwatch/enterprise-billing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
/**
 * Mock setup for SubscriptionPage tests. vi.mock() calls must be in test
 * files; renderSubscriptionPage helper lives in .tsx files.
 */
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Mutable mock organisation (reset per-test via resetMocks)
// ---------------------------------------------------------------------------
export const mockOrganization: {
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
  delete mockOrganization.pricingModel;
  delete mockOrganization.currency;
  Object.assign(mockOrganization, value);
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
  maxMessagesPerMonth: 50000,
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
  data: [] as {
    id?: string;
    email?: string;
    role: string;
    status: string;
  }[],
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

export const mockListInvoices = vi.fn(() => ({
  data: [] as DisplayInvoice[],
  isLoading: false,
  isError: false,
}));

export const mockGetLastSubscription = vi.fn(() => ({
  data: null,
  isLoading: false,
}));

export const mockOpenSeats = vi.fn();

// ---------------------------------------------------------------------------
// resetMocks — call in every test file's beforeEach
// ---------------------------------------------------------------------------
export function resetMocks() {
  vi.clearAllMocks();
  setMockOrganization({ id: "test-org-id", name: "Test Org", currency: "EUR" });
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
  mockListInvoices.mockReturnValue({
    data: [] as DisplayInvoice[],
    isLoading: false,
    isError: false,
  });
  mockGetLastSubscription.mockReturnValue({
    data: null,
    isLoading: false,
  });
}
