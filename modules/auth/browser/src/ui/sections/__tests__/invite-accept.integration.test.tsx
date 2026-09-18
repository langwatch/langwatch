/**
 * @vitest-environment jsdom
 * Invite-accept: shows error with action on failure, never dead-ends on loading.
 */
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcceptInviteStatus } from "../../../behavior/use-accept-invite-once.ts";

const { hardRedirectSpy, signOutSpy, mockAcceptState, mockQuery } = vi.hoisted(() => ({
  hardRedirectSpy: vi.fn(),
  signOutSpy: vi.fn(),
  mockAcceptState: {
    status: "error" as AcceptInviteStatus,
    error: null as unknown,
  },
  mockQuery: { inviteCode: "invite-abc" as string | undefined },
}));

vi.mock("../../../behavior/use-route.ts", () => ({
  useRouter: () => ({ query: mockQuery }),
}));

vi.mock("../../../behavior/use-required-session.ts", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

// The page this file covers is the one a deployment gets before the
// identifier-first front door is enforced (ADR-117 §7): accept on arrival,
// explain the failure, offer the way out. The landing screen that replaces it
// at the flip has its own tests.
vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { IDENTITY_FRONT_DOOR: false } }),
}));

vi.mock("../../../behavior/use-accept-invite-once.ts", () => ({
  useAcceptInviteOnce: () => mockAcceptState,
}));

vi.mock("../../../behavior/auth-client.tsx", () => ({
  signOut: signOutSpy,
}));

vi.mock("../../../behavior/hard-redirect.ts", () => ({
  hardRedirect: hardRedirectSpy,
}));

import Accept from "../invite-accept-screen.tsx";

function renderAccept() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Accept />
    </ChakraProvider>,
  );
}

describe("Accept invite page", () => {
  beforeEach(() => {
    hardRedirectSpy.mockReset();
    signOutSpy.mockReset();
    mockQuery.inviteCode = "invite-abc";
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the invite acceptance failed", () => {
    beforeEach(() => {
      mockAcceptState.status = "error";
      // The shape tRPC puts on the wire for a message a procedure wrote to be
      // read: a 4xx marked `authored` (see `readAuthoredMessage`).
      mockAcceptState.error = Object.assign(
        new Error(
          "The invite was sent to invitee@example.com, but you are signed in as someone-else@example.com",
        ),
        { data: { httpStatus: 400, authored: true } },
      );
    });

    describe("when the page renders", () => {
      it("shows the explanation the procedure authored for the user", () => {
        renderAccept();

        expect(
          screen.getByText("An error occurred while accepting the invite"),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            "The invite was sent to invitee@example.com, but you are signed in as someone-else@example.com",
          ),
        ).toBeInTheDocument();
      });

      it("offers both a dashboard escape hatch and a re-login action", () => {
        renderAccept();

        expect(screen.getByRole("button", { name: "Go to Dashboard" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Log Out and Try Again" })).toBeInTheDocument();
      });
    });

    describe("when the user clicks 'Go to Dashboard'", () => {
      it("hard-navigates home so stale pre-invite caches are busted", async () => {
        const user = userEvent.setup();
        renderAccept();

        await user.click(screen.getByRole("button", { name: "Go to Dashboard" }));

        expect(hardRedirectSpy).toHaveBeenCalledWith("/");
        expect(signOutSpy).not.toHaveBeenCalled();
      });
    });

    describe("when the user clicks 'Log Out and Try Again'", () => {
      it("signs the user out", async () => {
        const user = userEvent.setup();
        renderAccept();

        await user.click(screen.getByRole("button", { name: "Log Out and Try Again" }));

        expect(signOutSpy).toHaveBeenCalled();
        expect(hardRedirectSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the acceptance is still in flight", () => {
    it("renders the loading screen without any error alert", () => {
      mockAcceptState.status = "loading";
      mockAcceptState.error = null;

      renderAccept();

      expect(
        screen.queryByText("An error occurred while accepting the invite"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the link arrived without its code", () => {
    beforeEach(() => {
      mockQuery.inviteCode = void 0;
      // There is nothing to accept, so the hook never leaves `idle` — which
      // used to render the loading screen for the life of the page.
      mockAcceptState.status = "idle";
      mockAcceptState.error = null;
    });

    it("says the link is incomplete instead of waiting forever", () => {
      renderAccept();

      expect(screen.getByText(/invitation link is incomplete/i)).toBeInTheDocument();
    });
  });
});
