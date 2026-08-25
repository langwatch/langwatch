/**
 * @vitest-environment jsdom
 *
 * The post-login half of join-before-create (D12): an existing account whose
 * verified domain matches an organization is offered it too, not only
 * somebody mid-sign-up.
 *
 * Once, and dismissible. This is an offer rather than a task, so somebody who
 * has already decided they do not want it should never see it again — and the
 * decision is remembered per domain, on the account.
 *
 * Spec: specs/identity/join-before-create.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { offerRef, dismissMock, invalidateMock } = vi.hoisted(() => ({
  offerRef: { current: { data: undefined as unknown } },
  dismissMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      joinRequests: { offer: { invalidate: invalidateMock } },
    }),
    joinRequests: {
      offer: { useQuery: () => offerRef.current },
      dismissOffer: {
        useMutation: () => ({ mutate: dismissMock, isPending: false }),
      },
    },
  },
}));

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user_sam" } } }),
}));

import { JoinYourTeamNotice } from "../JoinYourTeamNotice";

const renderNotice = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <JoinYourTeamNotice />
    </ChakraProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  offerRef.current = {
    data: {
      outcome: "ask",
      organizations: [
        { organizationId: "org_acme", name: "Acme", colleagueCount: 10 },
      ],
    },
  };
});

afterEach(() => cleanup());

describe("given an existing account whose domain matches an organization", () => {
  describe("when they sign in", () => {
    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("offers the organization once, with a way in", () => {
      renderNotice();

      expect(screen.getByTestId("join-your-team-notice")).toBeInTheDocument();
      expect(screen.getByText(/Acme/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Ask to join/ })).toHaveAttribute(
        "href",
        "/auth/join",
      );
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("remembers the dismissal so it stops appearing for that domain", async () => {
      renderNotice();

      await userEvent.click(screen.getByTestId("dismiss-join-offer"));

      // The domain is taken server-side from the caller's own verified
      // address, so there is nothing here to point at somebody else's.
      expect(dismissMock).toHaveBeenCalledTimes(1);
      expect(dismissMock.mock.calls[0]?.[0]).toEqual({});
    });

    /** @scenario An existing user is offered their colleagues once, and can dismiss it */
    it("renders nothing once the offer has been waved away", () => {
      // What the server answers after a dismissal: the same nothing every
      // other closed door gives.
      offerRef.current = { data: { outcome: "none" } };
      const { container } = renderNotice();

      expect(container.innerHTML).toBe("");
    });
  });
});

describe("given a domain no organization is open to", () => {
  describe("when they sign in", () => {
    it("says nothing at all", () => {
      offerRef.current = { data: { outcome: "none" } };
      const { container } = renderNotice();

      expect(container.innerHTML).toBe("");
    });

    it("says nothing while the answer is still in flight", () => {
      offerRef.current = { data: undefined };
      const { container } = renderNotice();

      expect(container.innerHTML).toBe("");
    });
  });
});
