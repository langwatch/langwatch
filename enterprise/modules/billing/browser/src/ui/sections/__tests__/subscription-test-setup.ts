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

/** The server's held seats: none unless a test says otherwise. */
export const mockListHeldSeats = vi.fn(
  (): {
    data:
      | { heldSeats: { userId: string; email: string | null; seatFreesAt: string }[] }
      | undefined;
  } => ({
    data: { heldSeats: [] },
  }),
);

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
    displayStatus: string;
  }[],
  isLoading: false,
}));

export type MockSeatLimitInfo = {
  status: "ok" | "exceeded";
  message: string;
};

export type MockMessageLimitInfo = {
  status: "ok" | "warning" | "exceeded";
  current: number;
  max: number;
  currentFormatted: string;
  maxFormatted: string;
  percentageFormatted: string;
  message: string;
};

// Defaults to the usage query not having answered yet, which is the state
// the page falls back to its own member count in. Suites about the seat
// limit set real usage data.
export const mockGetUsage = vi.fn(
  (): {
    data:
      | {
          seatLimitInfo: MockSeatLimitInfo;
          membersCount: number;
          currentMonthMessagesCount?: number | null;
          messageLimitInfo?: MockMessageLimitInfo;
          usageUnit?: "traces" | "events";
        }
      | undefined;
    isLoading: boolean;
    refetch: () => void;
  } => ({
    data: undefined,
    isLoading: true,
    refetch: vi.fn(),
  }),
);

export const mockDetectCurrency = vi.fn(() => ({
  data: { currency: "EUR" as "EUR" | "USD" },
  isLoading: false,
}));

export const mockCreateInvitesMutate = vi.fn();
export const mockCreateInvites = vi.fn(() => ({
  mutate: mockCreateInvitesMutate,
  mutateAsync: mockCreateInvitesMutateAsync,
  isLoading: false,
  isPending: false,
}));

export const mockListInvoices = vi.fn(
  (): {
    data: DisplayInvoice[] | undefined;
    isLoading: boolean;
    isError: boolean;
    error?: { data: { httpStatus: number } };
  } => ({ data: [], isLoading: false, isError: false }),
);

export const mockGetLastSubscription = vi.fn((): { data: unknown; isLoading: boolean } => ({
  data: null,
  isLoading: false,
}));

export const mockOpenSeats = vi.fn();

export const mockDeveloperSeatsRefetch = vi.fn(async () => undefined);

/** Developer seats as billing answers them; unavailable until a test configures a price. */
export const mockDeveloperSeats = vi.fn(
  (): { data: unknown; isLoading: boolean; isError?: boolean } => ({
    data: {
      available: false,
      quantity: 0,
      unitAmountCents: null,
      currency: "EUR",
      billingInterval: "month",
      periodEndsAt: Date.UTC(2026, 11, 1),
    },
    isLoading: false,
  }),
);
export const mockPreviewDeveloperSeats = vi.fn(
  (_input: { quantity: number }): { data: unknown; isLoading: boolean; isError: boolean } => ({
    data: undefined,
    isLoading: true,
    isError: false,
  }),
);
export const mockSetDeveloperSeats = vi.fn(async (_input: unknown) => ({ success: true }));
/** What `createInvites` answers: the invitations it created. */
export const mockCreateInvitesMutateAsync = vi.fn(async (_input: unknown): Promise<unknown> => [
  { id: "invite-1" },
]);

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
  mockListHeldSeats.mockReturnValue({ data: { heldSeats: [] } });
  mockGetUsage.mockReturnValue({
    data: undefined,
    isLoading: true,
    refetch: vi.fn(),
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
  mockDeveloperSeats.mockReturnValue({
    data: {
      available: false,
      quantity: 0,
      unitAmountCents: null,
      currency: "EUR",
      billingInterval: "month",
      periodEndsAt: Date.UTC(2026, 11, 1),
    },
    isLoading: false,
  });
  mockPreviewDeveloperSeats.mockReturnValue({ data: undefined, isLoading: true, isError: false });
  mockSetDeveloperSeats.mockResolvedValue({ success: true });
  mockCreateInvitesMutateAsync.mockResolvedValue([{ id: "invite-1" }]);
}
