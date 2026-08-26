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
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { offerRef, mineRef, dismissMock, requestMock, invalidateOffer, invalidateMine } =
  vi.hoisted(() => ({
    offerRef: { current: { data: undefined as unknown, isPending: false } },
    mineRef: { current: { data: [] as unknown[], isPending: false } },
    dismissMock: vi.fn(),
    requestMock: vi.fn(),
    invalidateOffer: vi.fn(),
    invalidateMine: vi.fn(),
  }));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      joinRequests: {
        offer: { invalidate: invalidateOffer },
        mine: { invalidate: invalidateMine },
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
  },
}));

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user_sam" } } }),
}));

import { JoinYourTeamTakeover } from "../JoinYourTeamTakeover";

const renderTakeover = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <JoinYourTeamTakeover />
    </ChakraProvider>,
  );

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
      expect(screen.getByRole("button", { name: /Ask to join Acme/ })).toBeInTheDocument();
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("asks in place, so nothing navigates and nothing is created", async () => {
      renderTakeover();

      await userEvent.click(screen.getByRole("button", { name: /Ask to join Acme/ }));

      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(requestMock.mock.calls[0]?.[0]).toEqual({
        organizationId: "org_acme",
      });
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("keeps a way past that is one press and is remembered", async () => {
      renderTakeover();

      await userEvent.click(
        screen.getByRole("button", { name: /Not now/ }),
      );

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
          organization: { organizationId: "org_acme", name: "Acme", colleagueCount: 10 },
        },
        isPending: false,
      };
      const { container } = renderTakeover();

      expect(container.innerHTML).toBe("");
    });
  });
});
