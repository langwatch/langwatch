/**
 * @vitest-environment jsdom
 *
 * Regression coverage for langwatch/langwatch#5550:
 * when `acceptInvite` fails, the page must tell the user what happened and
 * offer a way out — a "Go to Dashboard" action next to "Log Out and Try
 * Again" — instead of dead-ending on the loading screen with the error only
 * in the console.
 *
 * The words come from `~/features/errors`, never from `error.message`: since
 * #5984 that is the code slug, and this page is the last thing a signed-out
 * visitor with a dead invite link sees.
 */
import "@testing-library/jest-dom/vitest";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcceptInviteStatus } from "~/hooks/useAcceptInviteOnce";

const { hardRedirectSpy, signOutSpy, mockAcceptState } = vi.hoisted(() => ({
  hardRedirectSpy: vi.fn(),
  signOutSpy: vi.fn(),
  mockAcceptState: {
    status: "error" as AcceptInviteStatus,
    error: null as unknown,
  },
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: { inviteCode: "invite-abc" } }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

// The page this file covers is the one a deployment gets before the
// identifier-first front door is enforced (ADR-117 §7): accept on arrival,
// explain the failure, offer the way out. The landing screen that replaces it
// at the flip has its own tests.
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IDENTITY_FRONT_DOOR: false } }),
}));

vi.mock("~/hooks/useAcceptInviteOnce", () => ({
  useAcceptInviteOnce: () => mockAcceptState,
}));

vi.mock("~/utils/auth-client", () => ({
  signOut: signOutSpy,
}));

vi.mock("~/utils/hardRedirect", () => ({
  hardRedirect: hardRedirectSpy,
}));

import Accept from "../accept";

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

        expect(
          screen.getByRole("button", { name: "Go to Dashboard" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Log Out and Try Again" }),
        ).toBeInTheDocument();
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
});
