/**
 * @vitest-environment jsdom
 *
 * Integration tests for SubscriptionPage — drawer interactions:
 * open/close, add/remove seats, cancel, email entry, invite separation,
 * auto-fill behaviour, and free-plan seat flow.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
});
