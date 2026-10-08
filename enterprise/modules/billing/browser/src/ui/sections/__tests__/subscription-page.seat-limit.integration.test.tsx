/**
 * @vitest-environment jsdom
 * SubscriptionPage when the organization uses more seats than its plan
 * includes, and which invites hold a seat. @see specs/licensing/subscription-page.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { StripeEnvironment } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  mockCreateSubscription,
  mockGetActivePlan,
  mockGetOrganizationWithMembers,
  mockGetPendingInvites,
  mockGetUsage,
  mockOrganization,
  mockOrganizationMembers,
  resetMocks,
  setMockOrganization,
} from "./subscription-test-setup.ts";

class TestBillingHost extends BillingHostApi {
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

  routeQuery(): Readonly<Record<string, string | undefined>> {
    return {};
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

  navigate(to: string): void {
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

const renderSubscriptionPage = () => {
  const host = new TestBillingHost();
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
vi.mock("@langwatch/browser-host/upgrade-modal-store", async () => {
  const setup = await import("./subscription-test-setup.ts");
  return {
    useUpgradeModalStore: (
      selector: (state: { openSeats: typeof setup.mockOpenSeats }) => unknown,
    ) => selector({ openSeats: setup.mockOpenSeats }),
  };
});

vi.mock("../../../behavior/billing-api.ts", async () => {
  const setup = await import("./subscription-test-setup.ts");
  return {
    billingApi: {
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
      },
      invite: {
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
        upgradeWithInvites: {
          useMutation: () => setup.mockUpgradeWithInvites(),
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
          useQuery: () => setup.mockGetLastSubscription(),
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

const memberFixture = ({ id, role }: { id: string; role: "ADMIN" | "MEMBER" | "EXTERNAL" }) => ({
  userId: id,
  role,
  user: {
    id,
    name: id,
    email: `${id}@example.com`,
    teamMemberships: [],
  },
});

const givenMembers = (extra: { id: string; role: "ADMIN" | "MEMBER" | "EXTERNAL" }[]) => {
  mockGetOrganizationWithMembers.mockReturnValue({
    data: {
      ...mockOrganizationMembers,
      members: [...mockOrganizationMembers.members, ...extra.map(memberFixture)],
    },
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenSeatLimitExceeded = (message: string, membersCount = 3) => {
  mockGetUsage.mockReturnValue({
    data: { seatLimitInfo: { status: "exceeded", message }, membersCount },
    isLoading: false,
    refetch: vi.fn(),
  });
};

const invite = ({ id, displayStatus }: { id: string; displayStatus: "PENDING" | "EXPIRED" }) => ({
  id,
  email: `${id}@example.com`,
  role: "MEMBER",
  status: "PENDING",
  displayStatus,
});

describe("<SubscriptionPage/> seat limit", () => {
  beforeEach(() => {
    resetMocks();
    mockGetUsage.mockReturnValue({
      data: { seatLimitInfo: { status: "ok", message: "" }, membersCount: 2 },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockGetActivePlan.mockReturnValue({
      data: createMockPlan({ maxMembers: 2, maxMembersLite: 0 }),
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a Free organization has more members than the plan includes", () => {
    beforeEach(() => {
      givenMembers([{ id: "user-3", role: "MEMBER" }]);
      givenSeatLimitExceeded(
        "Your organization uses 3 member seats and your plan includes 2 member seats.",
      );
    });

    /** @scenario "The billing page marks an upgrade as required when seats are over the plan" */
    it("marks the upgrade as required and explains the overage", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText("3 / 2")).toBeInTheDocument();
      });
      expect(screen.getByText("Upgrade required")).toBeInTheDocument();
      expect(screen.getByTestId("seat-limit-callout")).toHaveTextContent(
        "Your organization uses 3 member seats and your plan includes 2 member seats. Upgrade to the Growth plan below to keep everyone.",
      );
      expect(screen.getByTestId("upgrade-plan-block")).toBeInTheDocument();
    });
  });

  describe("when a Free organization has a Lite Member the plan does not include", () => {
    beforeEach(() => {
      mockGetOrganizationWithMembers.mockReturnValue({
        data: {
          ...mockOrganizationMembers,
          members: [
            mockOrganizationMembers.members[0]!,
            memberFixture({ id: "viewer-1", role: "EXTERNAL" }),
          ],
        },
        isLoading: false,
        refetch: vi.fn(),
      });
      givenSeatLimitExceeded(
        "Your organization uses 1 Lite Member seat and your plan includes no Lite Member seats.",
      );
    });

    /** @scenario "The billing page counts Lite Members above the plan as over the limit" */
    it("marks the upgrade as required", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText("Upgrade required")).toBeInTheDocument();
      });
      expect(screen.getByTestId("seat-limit-callout")).toHaveTextContent(
        "Your organization uses 1 Lite Member seat and your plan includes no Lite Member seats.",
      );
    });
  });

  describe("when a Free organization is within the plan", () => {
    /** @scenario "The billing page does not mark an upgrade as required within the plan" */
    it("does not mark the upgrade as required", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText("2 / 2")).toBeInTheDocument();
      });
      expect(screen.queryByText("Upgrade required")).toBeNull();
      expect(screen.queryByTestId("seat-limit-callout")).toBeNull();
    });
  });

  describe("when an invite has expired", () => {
    beforeEach(() => {
      // Before the usage query answers, the page counts members and invites
      // itself.
      mockGetUsage.mockReturnValue({
        data: undefined,
        isLoading: true,
        refetch: vi.fn(),
      });
      mockGetPendingInvites.mockReturnValue({
        data: [invite({ id: "expired-1", displayStatus: "EXPIRED" })],
        isLoading: false,
      });
    });

    /** @scenario "Expired invites do not count toward seats on the billing page" */
    it("leaves the expired invite out of the seat count", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText("2 / 2")).toBeInTheDocument();
      });
      expect(screen.queryByText("Upgrade required")).toBeNull();
      expect(screen.queryByTestId("seat-limit-callout")).toBeNull();
    });
  });

  describe("when upgrading with one open and one expired invite", () => {
    beforeEach(() => {
      mockGetPendingInvites.mockReturnValue({
        data: [
          invite({ id: "open-1", displayStatus: "PENDING" }),
          invite({ id: "expired-1", displayStatus: "EXPIRED" }),
        ],
        isLoading: false,
      });
      givenSeatLimitExceeded(
        "Your organization uses 3 member seats and your plan includes 2 member seats.",
      );
    });

    /** @scenario "Expired invites are not billed when upgrading" */
    it("checks out for the members plus the open invite only", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText("3 / 2")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /Upgrade now/i }));

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ membersToAdd: 3 }));
      });
    });
  });

  describe("when a Growth organization has more members than its seats", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          planSource: "subscription",
          type: "GROWTH_SEAT_EUR_MONTHLY",
          name: "Growth",
          free: false,
          maxMembers: 2,
          maxMembersLite: 9999,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
      givenMembers([{ id: "user-3", role: "MEMBER" }]);
      givenSeatLimitExceeded(
        "Your organization uses 3 member seats and your plan includes 2 member seats.",
      );
    });

    it("offers to add seats", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("seat-limit-callout")).toHaveTextContent(
          "Add seats to keep everyone.",
        );
      });
      expect(screen.getByText("Upgrade required")).toBeInTheDocument();
    });
  });

  describe("when an Enterprise organization uses more seats than it bought", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          planSource: "subscription",
          type: "ENTERPRISE",
          name: "Enterprise",
          free: false,
          maxMembers: 2,
          maxMembersLite: 9999,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
      givenMembers([{ id: "user-3", role: "MEMBER" }]);
      givenSeatLimitExceeded(
        "Your organization uses 3 member seats and your plan includes 2 member seats.",
      );
    });

    it("offers to contact sales instead of an upgrade", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("seat-limit-callout")).toHaveTextContent(
          "Contact sales to add seats.",
        );
      });
      expect(screen.getByRole("link", { name: "Contact sales" })).toBeInTheDocument();
      expect(screen.queryByText("Upgrade required")).toBeNull();
      expect(screen.queryByTestId("upgrade-plan-block")).toBeNull();
    });
  });

  describe("when the server counts a seat the page cannot classify", () => {
    beforeEach(() => {
      // An EXTERNAL member with a custom role that can write holds a full
      // seat; only the server sees the custom role's permissions.
      givenMembers([{ id: "editor-1", role: "EXTERNAL" }]);
      givenSeatLimitExceeded(
        "Your organization uses 3 member seats and your plan includes 2 member seats.",
        3,
      );
    });

    it("shows the server's seat count", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByText("3 / 2")).toBeInTheDocument();
      });
    });

    it("checks out for at least the seats the server counts", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      fireEvent.click(await screen.findByRole("button", { name: /Upgrade now/i }));

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ membersToAdd: 3 }));
      });
    });
  });

  describe("when a legacy tiered organization upgrades while the server counts more seats", () => {
    beforeEach(() => {
      setMockOrganization({
        id: "test-org-id",
        name: "Test Org",
        currency: "EUR",
        pricingModel: "TIERED",
      });
      mockGetActivePlan.mockReturnValue({
        data: createMockPlan({
          planSource: "subscription",
          type: "ACCELERATE",
          name: "Accelerate",
          free: false,
          maxMembers: 2,
          maxMembersLite: 9999,
        }),
        isLoading: false,
        refetch: vi.fn(),
      });
      givenMembers([{ id: "editor-1", role: "EXTERNAL" }]);
      givenSeatLimitExceeded(
        "Your organization uses 3 member seats and your plan includes 2 member seats.",
        3,
      );
    });

    it("checks out for at least the seats the server counts", async () => {
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      fireEvent.click(await screen.findByRole("button", { name: /Upgrade now/i }));

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ membersToAdd: 3 }));
      });
    });
  });
});
