/**
 * @vitest-environment jsdom
 *
 * The post-login half of join-before-create (D12), as a WHOLE SCREEN.
 *
 * This was an info alert pinned above the dashboard, and the weight was wrong
 * in both directions: it is the most consequential thing we can tell somebody
 * who has just landed — your team is already here, and everything you build
 * before you notice is in the wrong place — and a strip above the page is
 * what we use for "your trial ends Friday". People scrolled past it.
 *
 * So the cases below are about WEIGHT and about ESCAPE, which are the two
 * halves that have to hold together. It takes the screen; "not now" is a real
 * answer, remembered per domain, one press away; and asking leads straight
 * into the waiting state rather than dropping somebody back on a dashboard
 * that looks like nothing happened — which is the moment people ask twice or
 * give up and make the second workspace this screen exists to prevent.
 *
 * Spec: specs/identity/join-before-create.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  offerRef,
  mineRef,
  invitationsRef,
  admitFailedRef,
  dismissMock,
  requestMock,
  admitMock,
  acceptInviteMock,
  invalidateOffer,
  invalidateMine,
  invalidateOrganizations,
  invalidateInvitations,
  dismissNudge,
  signOutMock,
} = vi.hoisted(() => ({
  offerRef: { current: { data: undefined as unknown, isPending: false } },
  mineRef: { current: { data: [] as unknown[], isPending: false } },
  invitationsRef: {
    current: {
      data: [] as unknown[] | undefined,
      isPending: false,
      isSuccess: true,
    },
  },
  admitFailedRef: { current: false },
  dismissMock: vi.fn(),
  requestMock: vi.fn(),
  admitMock: vi.fn(),
  acceptInviteMock: vi.fn(),
  invalidateOffer: vi.fn(),
  invalidateMine: vi.fn(),
  invalidateOrganizations: vi.fn(),
  invalidateInvitations: vi.fn(),
  dismissNudge: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      joinRequests: {
        offer: { invalidate: invalidateOffer },
        mine: { invalidate: invalidateMine },
      },
      invite: { pendingForMe: { invalidate: invalidateInvitations } },
      organization: { getAll: { invalidate: invalidateOrganizations } },
      user: {
        secureAccountNudge: {
          invalidate: vi.fn(),
          cancel: vi.fn(),
          setData: vi.fn(),
        },
      },
    }),
    joinRequests: {
      offer: { useQuery: () => offerRef.current },
      mine: { useQuery: () => mineRef.current },
      dismissOffer: {
        useMutation: () => ({ mutate: dismissMock, isPending: false }),
      },
      request: {
        useMutation: () => ({ mutate: requestMock, isPending: false }),
      },
      admitAutomatically: {
        useMutation: () => ({
          mutate: admitMock,
          isPending: false,
          isError: admitFailedRef.current,
        }),
      },
    },
    invite: {
      pendingForMe: { useQuery: () => invitationsRef.current },
      acceptInvite: {
        useMutation: () => ({ mutate: acceptInviteMock, isPending: false }),
      },
    },
    user: {
      secureAccountNudge: {
        useQuery: () => ({
          data: {
            offer: true,
            passkey: true,
            twoStep: false,
            signedInWith: "password",
          },
        }),
      },
      dismissSecureAccountNudge: {
        useMutation: () => ({ mutate: dismissNudge }),
      },
    },
  },
}));

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user_sam" } } }),
  signOut: signOutMock,
  authClient: { passkey: { addPasskey: vi.fn() } },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

import { JoinYourTeamTakeover } from "../JoinYourTeamTakeover";
import { SecureAccountNudge } from "../me/SecureAccountNudge";

// These generic tests are not about a dashboard's own organization read —
// they exercise the offer/ask/waiting flow on its own — so they pass the
// deliberate "no organization context at all" value (`null`), the same one
// onboarding passes, rather than relying on omission to mean it.
const renderTakeover = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <JoinYourTeamTakeover currentOrganizationId={null} />
    </ChakraProvider>,
  );

function AccountPrompts() {
  return (
    <ChakraProvider value={defaultSystem}>
      <JoinYourTeamTakeover
        fallback={<SecureAccountNudge />}
        currentOrganizationId={null}
      />
    </ChakraProvider>
  );
}

const OFFERED = {
  data: {
    outcome: "ask",
    organizations: [
      { organizationId: "org_acme", name: "Acme", colleagueCount: 10 },
    ],
  },
  isPending: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  offerRef.current = { ...OFFERED };
  mineRef.current = { data: [], isPending: false };
  invitationsRef.current = { data: [], isPending: false, isSuccess: true };
  admitFailedRef.current = false;
});

afterEach(() => cleanup());

describe("given an existing account whose domain matches an organization", () => {
  describe("when they land on the dashboard", () => {
    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("takes the whole screen rather than sitting in a strip above the page", () => {
      renderTakeover();

      const takeover = screen.getByTestId("join-team-takeover");
      expect(takeover).toBeInTheDocument();
      // A dialog, so it is over the page rather than a row of it — and one
      // the page behind cannot be operated through.
      expect(takeover).toHaveAttribute("role", "dialog");
      expect(
        screen.getByRole("button", { name: /Ask to join Acme/ }),
      ).toBeInTheDocument();
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("asks in place, so nothing navigates and nothing is created", async () => {
      renderTakeover();

      await userEvent.click(
        screen.getByRole("button", { name: /Ask to join Acme/ }),
      );

      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(requestMock.mock.calls[0]?.[0]).toEqual({
        organizationId: "org_acme",
        origin: "web",
      });
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("keeps a way past that is one press and is remembered", async () => {
      renderTakeover();

      await userEvent.click(screen.getByRole("button", { name: /Not now/ }));

      // The domain is taken server-side from the caller's own verified
      // address, so there is nothing here to point at somebody else's.
      expect(dismissMock).toHaveBeenCalledTimes(1);
      expect(dismissMock.mock.calls[0]?.[0]).toEqual({});
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("renders nothing once the offer has been waved away", () => {
      offerRef.current = { data: { outcome: "none" }, isPending: false };
      const { container } = renderTakeover();

      expect(container.innerHTML).toBe("");
    });
  });
});

describe("given somebody who has already asked", () => {
  describe("when they land on the dashboard", () => {
    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("shows the waiting screen instead of offering the same organization again", () => {
      mineRef.current = {
        data: [{ joinRequestId: "jr_1", organizationId: "org_acme" }],
        isPending: false,
      };
      renderTakeover();

      expect(screen.getByTestId("join-team-waiting")).toBeInTheDocument();
      expect(screen.getByText(/Acme/)).toBeInTheDocument();
      // The mistake this prevents: asking twice because the first ask left no
      // trace on any screen they can see.
      expect(
        screen.queryByRole("button", { name: /Ask to join/ }),
      ).not.toBeInTheDocument();
    });

    it("says what happens next, so there is nothing left to guess", () => {
      mineRef.current = {
        data: [{ joinRequestId: "jr_1", organizationId: "org_acme" }],
        isPending: false,
      };
      renderTakeover();

      expect(screen.getByText(/We will email you/)).toBeInTheDocument();
    });

    /** @scenario "A pending join request can be left by signing out" */
    it("offers sign out from the full-screen waiting state", async () => {
      mineRef.current = {
        data: [{ joinRequestId: "jr_1", organizationId: "org_acme" }],
        isPending: false,
      };
      renderTakeover();

      await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

      expect(signOutMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("join-team-waiting")).toBeInTheDocument();
    });

    /** @scenario "A pending request for another organization does not block the current organization" */
    it("does not block an accessible organization for an unrelated pending request", () => {
      mineRef.current = {
        data: [{ joinRequestId: "jr_other", organizationId: "org_other" }],
        isPending: false,
      };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId="org_current"
            fallback={<div data-testid="current-organization" />}
          />
        </ChakraProvider>,
      );

      expect(screen.queryByTestId("join-team-waiting")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Ask to join/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("current-organization")).toBeInTheDocument();
    });

    it("still shows a pending request when there is no current organization", () => {
      mineRef.current = {
        data: [{ joinRequestId: "jr_other", organizationId: "org_other" }],
        isPending: false,
      };
      renderTakeover();

      expect(screen.getByTestId("join-team-waiting")).toBeInTheDocument();
    });

    /** @scenario "A pending request for another organization does not take over a dashboard that is still loading" */
    it("decides nothing while the current organization has not resolved yet", () => {
      mineRef.current = {
        data: [{ joinRequestId: "jr_other", organizationId: "org_other" }],
        isPending: false,
      };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId={undefined}
            fallback={<div data-testid="current-organization" />}
          />
        </ChakraProvider>,
      );

      expect(screen.queryByTestId("join-team-waiting")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Ask to join/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("current-organization")).toBeInTheDocument();
    });

    /** @scenario "A pending request for another organization does not block the current organization" */
    it("shows the waiting screen once the current organization has resolved and the request is for it", () => {
      mineRef.current = {
        data: [{ joinRequestId: "jr_1", organizationId: "org_current" }],
        isPending: false,
      };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId="org_current"
            fallback={<div data-testid="current-organization" />}
          />
        </ChakraProvider>,
      );

      expect(screen.getByTestId("join-team-waiting")).toBeInTheDocument();
      expect(
        screen.queryByTestId("current-organization"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("given an answer that has not arrived yet", () => {
  describe("when either query is still in flight", () => {
    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("decides nothing, because acting on half an answer is acting on a guess", () => {
      mineRef.current = { data: [], isPending: true };
      const { container } = renderTakeover();

      // Offering to somebody who has already asked is exactly what showing
      // the offer mid-flight would do.
      expect(container.innerHTML).toBe("");
    });
  });
});

describe("given a domain no organization is open to", () => {
  describe("when they land on the dashboard", () => {
    it("says nothing at all", () => {
      offerRef.current = { data: { outcome: "none" }, isPending: false };
      const { container } = renderTakeover();

      expect(container.innerHTML).toBe("");
    });

    it("says nothing where the domain is admitted automatically", () => {
      // Not an offer to weigh: the arrival admits them without asking.
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      const { container } = renderTakeover();

      expect(container.innerHTML).toBe("");
    });
  });
});

describe("given a password sign-in that also earns a passkey offer", () => {
  /** @scenario An existing user is offered their colleagues once, and can dismiss it */
  it("keeps only the join decision accessible until it is dismissed", async () => {
    const view = render(<AccountPrompts />);

    const takeover = await screen.findByRole("dialog", {
      name: "Your colleagues are already here",
    });
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
    expect(takeover.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByTestId("secure-account-nudge")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "Not now — keep working on my own" }),
    );
    expect(dismissMock).toHaveBeenCalledWith({}, expect.any(Object));
    expect(screen.queryByTestId("secure-account-nudge")).toBeNull();

    offerRef.current = { data: { outcome: "none" }, isPending: false };
    view.rerender(<AccountPrompts />);

    const nudge = await screen.findByRole("dialog", {
      name: "Sign in faster next time",
    });
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
    expect(nudge.closest('[aria-hidden="true"]')).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dismissNudge).toHaveBeenCalledWith({});
  });

  for (const pendingQuery of ["offer", "mine"] as const) {
    /** @scenario The passkey offer follows a password, not a federated sign-in */
    it(`waits for the pending ${pendingQuery} query`, async () => {
      offerRef.current = {
        data: { outcome: "none" },
        isPending: pendingQuery === "offer",
      };
      mineRef.current = { data: [], isPending: pendingQuery === "mine" };
      const view = render(<AccountPrompts />);

      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();

      offerRef.current = { data: { outcome: "none" }, isPending: false };
      mineRef.current = { data: [], isPending: false };
      view.rerender(<AccountPrompts />);

      await screen.findByRole("dialog", { name: "Sign in faster next time" });
      expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
    });
  }

  /** @scenario An existing user is offered their colleagues once, and can dismiss it */
  it("keeps the waiting decision ahead of optional security enrollment", async () => {
    mineRef.current = {
      data: [{ joinRequestId: "jr_1", organizationId: "org_acme" }],
      isPending: false,
    };
    render(<AccountPrompts />);

    const waiting = await screen.findByRole("dialog", {
      name: "Waiting for an administrator",
    });
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
    expect(waiting.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
  });
});

describe("given somebody an administrator already invited", () => {
  const INVITED = {
    data: [
      { inviteCode: "code_1", organizationName: "Acme", role: "DEVELOPER" },
    ],
    isPending: false,
    isSuccess: true,
  };

  describe("when they reach the welcome screen", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("leads with accepting the invitation, naming the seat, and offers no ask beside it", () => {
      invitationsRef.current = { ...INVITED };
      renderTakeover();

      expect(screen.getByTestId("join-team-invitation")).toBeInTheDocument();
      expect(
        screen.queryByTestId("join-team-takeover"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Accept the invitation to Acme/ }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Developer/)).toBeInTheDocument();
      // The admin already answered; asking them again is the mistake this
      // prevents.
      expect(
        screen.queryByRole("button", { name: /Ask to join/ }),
      ).not.toBeInTheDocument();
    });

    /** @scenario A pending invitation is offered before asking to join */
    it("names any seat without an article that only fits some of them", () => {
      invitationsRef.current = {
        data: [
          { inviteCode: "code_1", organizationName: "Acme", role: "ADMIN" },
        ],
        isPending: false,
        isSuccess: true,
      };
      renderTakeover();

      expect(
        screen.getByText(
          "An administrator has already invited you, with the Admin seat.",
        ),
      ).toBeInTheDocument();
    });

    /** @scenario A pending invitation leads even while a request to join is open */
    it("leads with the invitation over the request already waiting", () => {
      invitationsRef.current = { ...INVITED };
      mineRef.current = {
        data: [{ joinRequestId: "jr_1", organizationId: "org_acme" }],
        isPending: false,
      };
      renderTakeover();

      // Waiting on the request would let an approval land the joiner seat;
      // accepting the invitation lands the seat the administrator chose and
      // withdraws the request.
      expect(screen.getByTestId("join-team-invitation")).toBeInTheDocument();
      expect(screen.queryByTestId("join-team-waiting")).not.toBeInTheDocument();
    });

    /** @scenario A pending invitation leads even while a request to join is open */
    it("drops the withdrawn request from view once the invitation is accepted", async () => {
      invitationsRef.current = { ...INVITED };
      mineRef.current = {
        data: [{ joinRequestId: "jr_1", organizationId: "org_acme" }],
        isPending: false,
      };
      acceptInviteMock.mockImplementation(
        (_input: unknown, options?: { onSuccess?: () => void }) =>
          options?.onSuccess?.(),
      );
      renderTakeover();

      await userEvent.click(
        screen.getByRole("button", { name: /Accept the invitation to Acme/ }),
      );

      // Accepting withdrew the request server-side; a stale cached copy
      // would put the waiting screen back up for a request that is gone.
      expect(invalidateMine).toHaveBeenCalledTimes(1);
      expect(invalidateOffer).toHaveBeenCalledTimes(1);
    });

    /** @scenario Accepting the invitation from the welcome screen lands the invited seat */
    it("accepts through the invitation's own path and lets the welcome redirect carry on", async () => {
      invitationsRef.current = { ...INVITED };
      acceptInviteMock.mockImplementation(
        (_input: unknown, options?: { onSuccess?: () => void }) =>
          options?.onSuccess?.(),
      );
      renderTakeover();

      await userEvent.click(
        screen.getByRole("button", { name: /Accept the invitation to Acme/ }),
      );

      expect(acceptInviteMock.mock.calls[0]?.[0]).toEqual({
        inviteCode: "code_1",
      });
      // Nothing navigates from here: the welcome screen's own redirect reads
      // the organization list and honours the continuation it was given.
      expect(invalidateOrganizations).toHaveBeenCalledTimes(1);
    });
  });

  describe("when they would rather not accept it now", () => {
    /** @scenario The invitation can be set aside without accepting it */
    it("steps aside to the screen beneath and admits nobody behind it", async () => {
      invitationsRef.current = { ...INVITED };
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId={null}
            dismissLabel="Create a new organization instead"
            fallback={<div data-testid="make-your-own" />}
          />
        </ChakraProvider>,
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: "Create a new organization instead",
        }),
      );

      expect(
        screen.queryByTestId("join-team-invitation"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("make-your-own")).toBeInTheDocument();
      // The invitation still stands, so walking through the door now would
      // make it impossible to accept later.
      expect(admitMock).not.toHaveBeenCalled();
    });

    /** @scenario The invitation can be set aside without accepting it */
    it("reaches the screen beneath in one click when the domain offer also stands", async () => {
      invitationsRef.current = { ...INVITED };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId={null}
            dismissLabel="Create a new organization instead"
            fallback={<div data-testid="make-your-own" />}
          />
        </ChakraProvider>,
      );

      await userEvent.click(
        screen.getByRole("button", {
          name: "Create a new organization instead",
        }),
      );

      expect(
        screen.queryByTestId("join-team-takeover"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("make-your-own")).toBeInTheDocument();
      // Nothing lasting is recorded: the ask screen's own refusal says it
      // will not ask about the domain again, and this button never did.
      expect(dismissMock).not.toHaveBeenCalled();
    });

    /** @scenario The invitation can be set aside without accepting it */
    it("re-reads the invitations when accepting fails, so a withdrawn one drops off", async () => {
      invitationsRef.current = { ...INVITED };
      acceptInviteMock.mockImplementation(
        (_input: unknown, options?: { onError?: (error: Error) => void }) =>
          options?.onError?.(new Error("invite_not_found")),
      );
      renderTakeover();

      await userEvent.click(
        screen.getByRole("button", { name: /Accept the invitation to Acme/ }),
      );

      expect(invalidateInvitations).toHaveBeenCalledTimes(1);
    });
  });

  describe("when they are on a dashboard that already has an organization in view", () => {
    /** @scenario The welcome screen honours an automatic door */
    it("is not covered by the invitation", () => {
      invitationsRef.current = { ...INVITED };
      offerRef.current = { data: { outcome: "none" }, isPending: false };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId="org_current"
            fallback={<div data-testid="current-organization" />}
          />
        </ChakraProvider>,
      );

      expect(
        screen.queryByRole("button", { name: /Accept the invitation/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("current-organization")).toBeInTheDocument();
    });
  });
});

describe("given a sign-up the device page sent to the welcome screen", () => {
  describe("when they ask to join", () => {
    /** @scenario A request made from the terminal lands as a Developer when approved */
    it("stamps the request as made from the terminal", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover currentOrganizationId={null} origin="cli" />
        </ChakraProvider>,
      );

      await userEvent.click(
        screen.getByRole("button", { name: /Ask to join Acme/ }),
      );

      expect(requestMock.mock.calls[0]?.[0]).toEqual({
        organizationId: "org_acme",
        origin: "cli",
      });
    });
  });

  describe("when the door is automatic", () => {
    /** @scenario The welcome screen honours an automatic door */
    it("admits them once, stamped from the terminal, and refreshes the organization list", async () => {
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      admitMock.mockImplementation(
        (_input: unknown, options?: { onSettled?: () => void }) =>
          options?.onSettled?.(),
      );
      const { rerender } = render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover currentOrganizationId={null} origin="cli" />
        </ChakraProvider>,
      );
      rerender(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover currentOrganizationId={null} origin="cli" />
        </ChakraProvider>,
      );

      await waitFor(() => expect(admitMock).toHaveBeenCalledTimes(1));
      expect(admitMock.mock.calls[0]?.[0]).toEqual({ origin: "cli" });
      expect(invalidateOrganizations).toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: /Ask to join/ }),
      ).not.toBeInTheDocument();
    });

    /** @scenario The welcome screen honours an automatic door */
    it("admits nobody on a dashboard that already has an organization in view", () => {
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId="org_current"
            fallback={<div data-testid="current-organization" />}
          />
        </ChakraProvider>,
      );

      expect(admitMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("current-organization")).toBeInTheDocument();
    });

    /** @scenario A pending invitation is offered before asking to join */
    it("leads with a waiting invitation and admits nobody behind it", async () => {
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      invitationsRef.current = {
        data: [
          { inviteCode: "code_1", organizationName: "Acme", role: "ADMIN" },
        ],
        isPending: false,
        isSuccess: true,
      };
      renderTakeover();

      expect(
        screen.getByRole("button", { name: /Accept the invitation to Acme/ }),
      ).toBeInTheDocument();
      // Admitting first would make them a member at the joiner seat and the
      // invitation, with the seat the administrator chose, could no longer be
      // accepted.
      await waitFor(() => expect(admitMock).not.toHaveBeenCalled());
      expect(
        screen.queryByTestId("join-team-admitting"),
      ).not.toBeInTheDocument();
    });

    /** @scenario The welcome screen honours an automatic door */
    it("waits for the invitation answer before walking through the door", () => {
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      invitationsRef.current = {
        data: undefined,
        isPending: true,
        isSuccess: false,
      };
      renderTakeover();

      expect(admitMock).not.toHaveBeenCalled();
    });

    /** @scenario The welcome screen honours an automatic door */
    it("keeps the door shut when the invitation answer failed to come back", async () => {
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      // A failed read is not an empty one: it may be hiding an invitation,
      // and admitting now would make that invitation impossible to accept.
      invitationsRef.current = {
        data: undefined,
        isPending: false,
        isSuccess: false,
      };
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId={null}
            fallback={<div data-testid="make-your-own" />}
          />
        </ChakraProvider>,
      );

      await waitFor(() => expect(admitMock).not.toHaveBeenCalled());
      expect(screen.getByTestId("make-your-own")).toBeInTheDocument();
    });

    /** @scenario The welcome screen honours an automatic door */
    it("steps aside when the admission is refused, so the screen beneath is reachable", () => {
      offerRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
        isPending: false,
      };
      admitFailedRef.current = true;
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinYourTeamTakeover
            currentOrganizationId={null}
            fallback={<div data-testid="make-your-own" />}
          />
        </ChakraProvider>,
      );

      expect(
        screen.queryByTestId("join-team-admitting"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("make-your-own")).toBeInTheDocument();
    });
  });
});
