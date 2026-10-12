/**
 * @vitest-environment jsdom
 *
 * The gate in front of the screen that creates an organization
 * (specs/auth/sign-up-restriction.feature).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { InvitationBeforeOnboarding } from "../InvitationBeforeOnboarding";

const { replace, publicEnv, pendingInvitation } = vi.hoisted(() => ({
  replace: vi.fn(),
  publicEnv: vi.fn(),
  pendingInvitation: vi.fn(),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => publicEnv(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    invite: {
      myPendingInvitation: {
        useQuery: (input: unknown, options: { enabled: boolean }) =>
          pendingInvitation(input, options),
      },
    },
  },
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

const renderGate = () =>
  render(
    <InvitationBeforeOnboarding>
      <div>create your organization</div>
    </InvitationBeforeOnboarding>,
  );

describe("<InvitationBeforeOnboarding/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publicEnv.mockReturnValue({
      data: { SIGN_UP_MODE: "invite_only" },
      isLoading: false,
    });
    pendingInvitation.mockReturnValue({ data: null, isLoading: false });
  });

  afterEach(cleanup);

  describe("given an installation where accounts are created by invitation", () => {
    describe("when an invitation is waiting for the person", () => {
      /** @scenario "An invited member who signed up from the sign-in screen is sent to their invitation" */
      it("sends them to the invitation and never shows the screen that creates an organization", async () => {
        pendingInvitation.mockReturnValue({
          data: { inviteCode: "abc 123" },
          isLoading: false,
        });

        renderGate();

        await waitFor(() =>
          expect(replace).toHaveBeenCalledWith(
            "/invite/accept?inviteCode=abc%20123",
          ),
        );
        expect(
          screen.queryByText("create your organization"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when no invitation is waiting", () => {
      it("shows the screen that creates an organization", () => {
        renderGate();

        expect(
          screen.getByText("create your organization"),
        ).toBeInTheDocument();
        expect(replace).not.toHaveBeenCalled();
      });
    });

    describe("when the answer is still out", () => {
      it("holds on the loading screen", () => {
        pendingInvitation.mockReturnValue({ data: undefined, isLoading: true });

        renderGate();

        expect(screen.getByText("loading")).toBeInTheDocument();
        expect(
          screen.queryByText("create your organization"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given an installation with open sign-up", () => {
    it("shows the screen that creates an organization without asking for an invitation", () => {
      publicEnv.mockReturnValue({
        data: { SIGN_UP_MODE: "open" },
        isLoading: false,
      });

      renderGate();

      expect(screen.getByText("create your organization")).toBeInTheDocument();
      expect(pendingInvitation).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ enabled: false }),
      );
      expect(replace).not.toHaveBeenCalled();
    });
  });
});
