/**
 * @vitest-environment jsdom
 *
 * Integration tests for SubscriptionPage when the organization uses more
 * seats than its plan includes (a plan that shrank under a full
 * organization), and for which invites hold a seat.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPage } from "../SubscriptionPage";
import {
  createMockPlan,
  mockCreateSubscription,
  mockGetActivePlan,
  mockGetOrganizationWithMembers,
  mockGetPendingInvites,
  mockGetUsage,
  mockOrganizationMembers,
  resetMocks,
} from "./subscription-test-setup";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderSubscriptionPage = () => {
  return render(<SubscriptionPage />, { wrapper: Wrapper });
};

// ---------------------------------------------------------------------------
// vi.mock declarations (hoisted, so they must be at module top-level)
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
    useUpgradeModalStore: (
      selector: (state: { openSeats: typeof setup.mockOpenSeats }) => unknown,
    ) => selector({ openSeats: setup.mockOpenSeats }),
  };
});

vi.mock("~/utils/api", async () => {
  const setup = await import("./subscription-test-setup");
  return {
    api: {
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
          useQuery: (
            _input: Record<string, never>,
            opts: { enabled: boolean },
          ) =>
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const memberFixture = ({
  id,
  role,
}: {
  id: string;
  role: "ADMIN" | "MEMBER" | "EXTERNAL";
}) => ({
  userId: id,
  role,
  user: {
    id,
    name: id,
    email: `${id}@example.com`,
    teamMemberships: [],
  },
});

const givenMembers = (
  extra: Array<{ id: string; role: "ADMIN" | "MEMBER" | "EXTERNAL" }>,
) => {
  mockGetOrganizationWithMembers.mockReturnValue({
    data: {
      ...mockOrganizationMembers,
      members: [
        ...mockOrganizationMembers.members,
        ...extra.map(memberFixture),
      ],
    },
    isLoading: false,
    refetch: vi.fn(),
  });
};

const givenSeatLimitExceeded = (message: string, membersCount?: number) => {
  mockGetUsage.mockReturnValue({
    data: { seatLimitInfo: { status: "exceeded", message }, membersCount },
    isLoading: false,
    refetch: vi.fn(),
  });
};

const invite = ({
  id,
  displayStatus,
}: {
  id: string;
  displayStatus: "PENDING" | "EXPIRED";
}) => ({
  id,
  email: `${id}@example.com`,
  role: "MEMBER",
  status: "PENDING",
  displayStatus,
});

describe("<SubscriptionPage/> seat limit", () => {
  beforeEach(() => {
    resetMocks();
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
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("3/2");
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
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("2/2");
      });
      expect(screen.queryByText("Upgrade required")).toBeNull();
      expect(screen.queryByTestId("seat-limit-callout")).toBeNull();
    });
  });

  describe("when an invite has expired", () => {
    beforeEach(() => {
      mockGetPendingInvites.mockReturnValue({
        data: [invite({ id: "expired-1", displayStatus: "EXPIRED" })],
        isLoading: false,
      });
    });

    /** @scenario "Expired invites do not count toward seats on the billing page" */
    it("leaves the expired invite out of the seat count", async () => {
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("2/2");
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
    });

    /** @scenario "Expired invites are not billed when upgrading" */
    it("checks out for the members plus the open invite only", async () => {
      const user = userEvent.setup();
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      await waitFor(() => {
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("3/2");
      });
      await user.click(screen.getByRole("button", { name: /Upgrade now/i }));

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ membersToAdd: 3 }),
        );
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
      expect(
        screen.getByRole("link", { name: "Contact sales" }),
      ).toBeInTheDocument();
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
        expect(screen.getByTestId("user-count-link")).toHaveTextContent("3/2");
      });
    });

    it("checks out for at least the seats the server counts", async () => {
      const user = userEvent.setup();
      const mutateAsync = vi.fn().mockResolvedValue({ url: null });
      mockCreateSubscription.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync,
        isLoading: false,
        isPending: false,
      });
      renderSubscriptionPage();

      await user.click(
        await screen.findByRole("button", { name: /Upgrade now/i }),
      );

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ membersToAdd: 3 }),
        );
      });
    });
  });
});
