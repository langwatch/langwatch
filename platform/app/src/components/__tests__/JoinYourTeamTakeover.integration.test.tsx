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
  dismissMock,
  requestMock,
  invalidateOffer,
  invalidateMine,
  dismissNudge,
  signOutMock,
} = vi.hoisted(() => ({
  offerRef: { current: { data: undefined as unknown, isPending: false } },
  mineRef: { current: { data: [] as unknown[], isPending: false } },
  dismissMock: vi.fn(),
  requestMock: vi.fn(),
  invalidateOffer: vi.fn(),
  invalidateMine: vi.fn(),
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

const renderTakeover = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <JoinYourTeamTakeover />
    </ChakraProvider>,
  );

function AccountPrompts() {
  return (
    <ChakraProvider value={defaultSystem}>
      <JoinYourTeamTakeover fallback={<SecureAccountNudge />} />
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
