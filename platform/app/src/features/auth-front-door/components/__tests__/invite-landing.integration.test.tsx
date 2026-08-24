/**
 * @vitest-environment jsdom
 *
 * The invitation landing (D13 renders it, D11 owns the rules underneath).
 *
 * Specs: specs/identity/signin-signup-screens.feature,
 *        specs/identity/resilient-invitations.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision } from "@langwatch/identity";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  landingRef,
  routeMock,
  acceptMock,
  signInMock,
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
  signInMock: vi.fn(),
  sessionRef: { current: { data: null as unknown } },
  hardRedirectMock: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    frontDoor: {
      inviteLanding: { useQuery: () => landingRef.current },
      route: {
        useMutation: () => ({
          mutateAsync: routeMock,
          isPending: false,
          error: null,
        }),
      },
    },
    organization: {
      acceptInvite: {
        useMutation: () => ({
          mutate: acceptMock,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => sessionRef.current,
  };
});

vi.mock("~/utils/hardRedirect", () => ({ hardRedirect: hardRedirectMock }));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { InviteLanding } from "../InviteLanding";

const INVITE_CODE = "invite-123";
const CARRIED = encodeURIComponent(`/invite/accept?inviteCode=${INVITE_CODE}`);

const localPicker: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [{ id: "password", kind: "password", connectionId: null }],
  reasonCode: "no_domain_match",
};

const handled = (code: string, httpStatus: number) => ({
  data: { error: { code, httpStatus, fault: "customer" } },
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

      expect(signInLink.getAttribute("href")).toBe(
        `/auth/signin?callbackUrl=${CARRIED}`,
      );
      expect(signUpLink.getAttribute("href")).toBe(
        `/auth/signup?callbackUrl=${CARRIED}`,
      );
    });

    /** @scenario A visitor with no account is guided through sign-up first */
    it("guides a visitor with no account into sign-up carrying the invitation", async () => {
      renderLanding();

      const signUpLink = await screen.findByRole("link", {
        name: /create an account/i,
      });
      expect(signUpLink.getAttribute("href")).toBe(
        `/auth/signup?callbackUrl=${CARRIED}`,
      );

      // Coming back from sign-up with a confirmed address, the same link
      // applies the invitation: the code was never altered on the way.
      cleanup();
      sessionRef.current = { data: { user: { id: "u1" } } };
      renderLanding();

      await userEvent.click(
        await screen.findByRole("button", { name: /join acme/i }),
      );
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
    /** @scenario An expired invite offers to ask for a new one */
    it("points at the person who can send a fresh one", async () => {
      landingRef.current = {
        data: undefined,
        error: handled("invite_expired", 410),
        isLoading: false,
      };

      renderLanding();

      expect(
        await screen.findByText(/this invitation has expired/i),
      ).toBeTruthy();
      expect(screen.getByText(/ask the person who invited you/i)).toBeTruthy();
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
