/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { MembersForm } from "../../components/AddMembersForm";
import { useInviteActions } from "../useInviteActions";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ organization: { id: "org-123" } }),
}));

const mockCheckLimitQuery = vi.fn();
const mockCreateInvites = vi.fn();
const mockExpandSeats = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    licenseEnforcement: {
      checkLimit: { useQuery: (...args: unknown[]) => mockCheckLimitQuery(...args) },
      reportLimitBlocked: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    organization: {
      createInvites: { useMutation: () => ({ mutate: mockCreateInvites }) },
      createInviteRequest: { useMutation: () => ({ mutate: vi.fn() }) },
      approveInvite: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteInvite: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    subscription: {
      addTeamMemberOrEvents: {
        useMutation: () => ({ mutateAsync: mockExpandSeats }),
      },
    },
  },
}));

const mockOpenSeats = vi.fn();
const mockOpenUpgradeModal = vi.fn();
vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (
    selector: (state: {
      open: typeof mockOpenUpgradeModal;
      openSeats: typeof mockOpenSeats;
    }) => unknown,
  ) => selector({ open: mockOpenUpgradeModal, openSeats: mockOpenSeats }),
}));

function makeForm(): MembersForm {
  return {
    invites: [
      {
        email: "seventh@example.com",
        orgRole: "MEMBER",
        teams: [{ teamId: "team-1", role: "MEMBER" }],
      },
    ],
  } as unknown as MembersForm;
}

function renderInviteActions() {
  return renderHook(() =>
    useInviteActions({
      organizationId: "org-123",
      isAdmin: true,
      hasEmailProvider: true,
      onInviteCreated: vi.fn(),
      onClose: vi.fn(),
      refetchInvites: vi.fn(),
      activePlanType: "GROWTH_SEAT_EUR_MONTHLY",
    }),
  );
}

describe("useInviteActions() — denial routing on resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when a seat-billed org at its cap invites another member", () => {
    beforeEach(() => {
      mockCheckLimitQuery.mockReturnValue({
        data: {
          allowed: false,
          current: 6,
          max: 6,
          limitType: "members",
          resolution: "purchase_seat",
        },
        isLoading: false,
      });
    });

    /** @scenario A seat-billed organization with a stale TIERED column is offered a seat purchase, not blocked */
    it("opens the seat purchase confirmation instead of hard-blocking", () => {
      // The resolution derives from the active seat subscription server-side,
      // so a drifted pricingModel column cannot reach this hook at all — the
      // incident class (blocked at 6/6 with no way forward) cannot recur.
      const { result } = renderHook(() =>
        useInviteActions({
          organizationId: "org-123",
          isAdmin: true,
          hasEmailProvider: true,
          onInviteCreated: vi.fn(),
          onClose: vi.fn(),
          refetchInvites: vi.fn(),
          activePlanType: "GROWTH_SEAT_EUR_MONTHLY",
        }),
      );

      act(() => {
        result.current.onSubmit(makeForm());
      });

      expect(mockOpenSeats).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          currentSeats: 6,
          newSeats: 7,
        }),
      );
      expect(mockOpenUpgradeModal).not.toHaveBeenCalled();
      expect(mockCreateInvites).not.toHaveBeenCalled();
    });

    /** @scenario Resolution purchase_seat opens the seat proration modal */
    it("routes purchase_seat to the proration modal", () => {
      const { result } = renderInviteActions();

      act(() => {
        result.current.onSubmit(makeForm());
      });

      expect(mockOpenSeats).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the denial resolves to upgrade", () => {
    it("opens the upgrade modal, not the seats modal", () => {
      mockCheckLimitQuery.mockReturnValue({
        data: {
          allowed: false,
          current: 5,
          max: 5,
          limitType: "members",
          resolution: "upgrade",
        },
        isLoading: false,
      });

      const { result } = renderInviteActions();

      act(() => {
        result.current.onSubmit(makeForm());
      });

      expect(mockOpenSeats).not.toHaveBeenCalled();
      expect(mockOpenUpgradeModal).toHaveBeenCalledWith(
        "members",
        5,
        5,
        "upgrade",
      );
    });
  });
});
