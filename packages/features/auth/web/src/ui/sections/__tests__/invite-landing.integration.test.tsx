/**
 * @vitest-environment jsdom
 *
 * The invitation landing (D13 renders it, D11 owns the rules underneath).
 *
 * Specs: specs/identity/signin-signup-screens.feature,
 *        specs/identity/resilient-invitations.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision } from "@langwatch/identity-contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  landingRef,
  routeMock,
  acceptMock,
  acceptStateRef,
  askMock,
  askStateRef,
  signInMock,
  signOutMock,
  sessionRef,
  hardRedirectMock,
} = vi.hoisted(() => ({
  landingRef: {
    current: {
      data: undefined as unknown,
      error: null as unknown,
      isLoading: false,
    },
  },
  routeMock: vi.fn(),
  acceptMock: vi.fn(),
  acceptStateRef: {
    current: { error: null as unknown, isPending: false },
  },
  askMock: vi.fn(),
  askStateRef: {
    current: { error: null as unknown, isPending: false, isSuccess: false },
  },
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
  sessionRef: { current: { data: null as unknown } },
  hardRedirectMock: vi.fn(),
}));

vi.mock("../../../behavior/auth-api", () => ({
  authApi: {
    frontDoor: {
      inviteLanding: { useQuery: () => landingRef.current },
      route: {
        useMutation: () => ({
          mutateAsync: routeMock,
          isPending: false,
          error: null,
        }),
      },
      requestFreshInvite: {
        useMutation: () => ({
          mutate: askMock,
          ...askStateRef.current,
        }),
      },
    },
    organization: {
      acceptInvite: {
        useMutation: () => ({
          mutate: acceptMock,
          ...acceptStateRef.current,
        }),
      },
    },
  },
}));

vi.mock("../../../behavior/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../behavior/auth-client")>();
  return {
    ...actual,
    signIn: signInMock,
    signOut: signOutMock,
    useSession: () => sessionRef.current,
  };
});

vi.mock("../../../behavior/hard-redirect", () => ({ hardRedirect: hardRedirectMock }));

vi.mock("../../elements/router-link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { InviteLanding } from "../invite-landing";

const INVITE_CODE = "invite-123";
const CARRIED = encodeURIComponent(`/invite/accept?inviteCode=${INVITE_CODE}`);

const localPicker: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [{ id: "password", kind: "password", connectionId: null }],
  reasonCode: "no_domain_match",
};

const handled = (code: string, httpStatus: number, meta: Record<string, unknown> = {}) => ({
  data: { error: { code, httpStatus, fault: "customer", meta } },
});

const renderLanding = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <InviteLanding inviteCode={INVITE_CODE} />
    </ChakraProvider>,
  );

describe("given an invitation link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRef.current = { data: null };
    acceptStateRef.current = { error: null, isPending: false };
    askStateRef.current = { error: null, isPending: false, isSuccess: false };
    routeMock.mockResolvedValue(localPicker);
    landingRef.current = {
      data: {
        organizationName: "Acme",
        inviterName: "Dana",
        alreadyAccepted: false,
      },
      error: null,
      isLoading: false,
    };
  });

  afterEach(() => cleanup());

  describe("when it is opened signed out", () => {
    /** @scenario An invite landing shows who is asking and every way in */
    it("names the organization and the inviter, and offers the routed methods", async () => {
      renderLanding();

      expect(await screen.findByTestId("invite-inviter")).toHaveTextContent(
        /Dana invited you to Acme/i,
      );
      expect(await screen.findByTestId("method-picker")).toBeTruthy();
      expect(routeMock).toHaveBeenCalledWith({
        identifier: null,
        breakGlass: false,
      });
    });

    /** @scenario An invite landing shows who is asking and every way in */
    it("carries the invitation through both ways in, untouched", async () => {
      renderLanding();

      const signInLink = await screen.findByRole("link", { name: /sign in/i });
      const signUpLink = screen.getByRole("link", {
        name: /create an account/i,
      });

      expect(signInLink.getAttribute("href")).toBe(`/auth/signin?callbackUrl=${CARRIED}`);
      expect(signUpLink.getAttribute("href")).toBe(`/auth/signup?callbackUrl=${CARRIED}`);
    });

    /** @scenario A visitor with no account is guided through sign-up first */
    it("guides a visitor with no account into sign-up carrying the invitation", async () => {
      renderLanding();

      const signUpLink = await screen.findByRole("link", {
        name: /create an account/i,
      });
      expect(signUpLink.getAttribute("href")).toBe(`/auth/signup?callbackUrl=${CARRIED}`);

      // Coming back from sign-up with a confirmed address, the same link
      // applies the invitation: the code was never altered on the way.
      cleanup();
      sessionRef.current = { data: { user: { id: "u1" } } };
      renderLanding();

      await userEvent.click(await screen.findByRole("button", { name: /join acme/i }));
      expect(acceptMock).toHaveBeenCalledWith({ inviteCode: INVITE_CODE });
    });
  });

  describe("when it is opened by somebody already signed in", () => {
    /** @scenario A signed-in visitor confirms and joins */
    it("asks for confirmation first, and joins on confirming", async () => {
      sessionRef.current = { data: { user: { id: "u1" } } };
      renderLanding();

      expect(await screen.findByTestId("invite-confirm")).toBeTruthy();
      expect(acceptMock).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: /join acme/i }));
      expect(acceptMock).toHaveBeenCalledWith({ inviteCode: INVITE_CODE });
    });
  });

  describe("when the invitation has expired", () => {
    const expiredLanding = () => {
      landingRef.current = {
        data: undefined,
        error: handled("invite_expired", 410),
        isLoading: false,
      };
    };

    /** @scenario The invitee can ask for a fresh invitation when theirs expired */
    it("says so, and offers to ask for a fresh one", async () => {
      expiredLanding();

      renderLanding();

      expect(await screen.findByText(/this invitation has expired/i)).toBeTruthy();
      expect(screen.getByTestId("invite-ask-again")).toBeTruthy();
    });

    /** @scenario The invitee can ask for a fresh invitation when theirs expired */
    it("asks with the code they arrived on", async () => {
      expiredLanding();
      renderLanding();

      await userEvent.click(await screen.findByTestId("invite-ask-again"));

      expect(askMock).toHaveBeenCalledWith({ inviteCode: INVITE_CODE });
    });

    /** @scenario The invitee can ask for a fresh invitation when theirs expired */
    it("confirms the ask landed without naming who was asked", async () => {
      expiredLanding();
      askStateRef.current = { error: null, isPending: false, isSuccess: true };

      renderLanding();

      const confirmation = await screen.findByTestId("invite-refresh-asked");
      expect(confirmation.textContent).toMatch(/fresh invitation/i);
      expect(screen.queryByTestId("invite-ask-again")).toBeNull();
    });

    /** @scenario Asking again is throttled per invitation */
    it("says how long to wait when the ask was too soon", async () => {
      expiredLanding();
      askStateRef.current = {
        error: handled("invite_throttled", 429, { retryAfterSeconds: 120 }),
        isPending: false,
        isSuccess: false,
      };

      renderLanding();

      expect(await screen.findByText(/that was just sent/i)).toBeTruthy();
      expect(screen.getByText(/2 minutes/i)).toBeTruthy();
    });
  });

  describe("when the visitor is signed in as a different account", () => {
    beforeEach(() => {
      sessionRef.current = { data: { user: { id: "u1" } } };
      acceptStateRef.current = {
        error: handled("invite_wrong_account", 403, {
          invitedHint: "s•••@acme.com",
        }),
        isPending: false,
      };
    });

    /** @scenario The wrong account is told which account the invitation wants */
    it("names the account it wants, masked, and never the whole address", async () => {
      renderLanding();

      expect(await screen.findByText(/you're signed in as a different account/i)).toBeTruthy();
      expect(screen.getByText(/s•••@acme\.com/)).toBeTruthy();
    });

    /** @scenario The wrong account is told which account the invitation wants */
    it("offers the way out instead of a join that cannot succeed", async () => {
      renderLanding();

      expect(await screen.findByTestId("invite-switch-account")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Join Acme$/ })).toBeNull();
    });

    /** @scenario Signing out from the mismatch returns to the same invitation */
    it("signs out and comes back to the same invitation", async () => {
      signOutMock.mockResolvedValue(undefined);
      renderLanding();

      await userEvent.click(await screen.findByTestId("invite-switch-account"));

      expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
      await vi.waitFor(() =>
        expect(hardRedirectMock).toHaveBeenCalledWith(`/invite/accept?inviteCode=${INVITE_CODE}`),
      );
    });
  });

  describe("when the invitation was revoked", () => {
    /** @scenario An expired invite offers to ask for a new one */
    it("ends the journey without naming the organization or the inviter", async () => {
      landingRef.current = {
        data: undefined,
        error: handled("invite_not_found", 404),
        isLoading: false,
      };

      const { container } = renderLanding();

      expect(await screen.findByTestId("invite-dead-end")).toBeTruthy();
      expect(container.textContent).not.toContain("Acme");
      expect(container.textContent).not.toContain("Dana");
      expect(screen.queryByTestId("method-picker")).toBeNull();
    });
  });
});
