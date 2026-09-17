/**
 * @vitest-environment jsdom
 *
 * Who the "secure your account" offer is for.
 *
 * ADR-120's rule is that a passkey is offered where it REPLACES a password.
 * What the account still lacks is the same whichever way somebody got in, so
 * that answer alone cannot decide whether to ask — and asking on it alone put
 * the dialog in front of every federated and every passkey sign-in, offering
 * one population something they cannot use and the other something they
 * already have.
 *
 * Spec: specs/identity/passkeys.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SignedInWith = "password" | "passkey" | "federated" | "unknown";

const { nudgeRef, dismissMock } = vi.hoisted(() => ({
  nudgeRef: {
    current: {
      offer: true,
      passkey: true,
      twoStep: false,
      signedInWith: "password" as SignedInWith,
    },
  },
  dismissMock: vi.fn(),
}));

// The query cache is modelled rather than stubbed away: the dialog is mounted
// on every page, so what it renders after a navigation is decided by what the
// cache holds, and a mock that forgets writes cannot show that.
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      user: {
        secureAccountNudge: {
          invalidate: vi.fn(),
          setData: (
            _input: unknown,
            updater: (
              previous: typeof nudgeRef.current,
            ) => typeof nudgeRef.current,
          ) => {
            nudgeRef.current = updater(nudgeRef.current);
          },
        },
      },
    }),
    user: {
      secureAccountNudge: { useQuery: () => ({ data: nudgeRef.current }) },
      dismissSecureAccountNudge: {
        useMutation: () => ({ mutate: dismissMock, isPending: false }),
      },
    },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { passkey: { addPasskey: vi.fn() } },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

import { SecureAccountNudge } from "../SecureAccountNudge";

const renderNudge = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SecureAccountNudge />
    </ChakraProvider>,
  );

const arriveWith = (signedInWith: SignedInWith) => {
  nudgeRef.current = {
    offer: true,
    passkey: true,
    twoStep: false,
    signedInWith,
  };
};

describe("the secure-account offer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arriveWith("password");
  });

  afterEach(() => {
    cleanup();
  });

  describe("given somebody who answered the offer with Not now", () => {
    describe("when the next page mounts the dialog again", () => {
      /** @scenario "A dismissal is remembered on the next page, not just in the dialog" */
      it("stays closed, because the answer reached the cached offer too", () => {
        renderNudge();
        fireEvent.click(screen.getByRole("button", { name: "Not now" }));

        expect(dismissMock).toHaveBeenCalled();
        // The dialog closing is local state; this is the part that survives a
        // navigation. `setUpTwoStep` navigates straight after answering, so
        // without it the offer reappears over the page it sent them to.
        cleanup();
        renderNudge();

        expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
      });
    });
  });

  describe("given an account that holds no passkey and has not been asked", () => {
    describe("when the sign-in was a password", () => {
      /** @scenario "The passkey offer follows a password, not a federated sign-in" */
      it("offers the passkey that would replace it", () => {
        renderNudge();

        expect(screen.getByTestId("secure-account-nudge")).toBeTruthy();
        expect(screen.getByTestId("nudge-create-passkey")).toBeTruthy();
      });
    });

    describe("when the sign-in came through an identity provider", () => {
      /** @scenario "The passkey offer follows a password, not a federated sign-in" */
      it("says nothing, because there is no password here to replace", () => {
        arriveWith("federated");
        renderNudge();

        expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
      });
    });

    describe("when the sign-in was a passkey", () => {
      /** @scenario "The passkey offer follows a password, not a federated sign-in" */
      it("says nothing, because they just used the thing being offered", () => {
        arriveWith("passkey");
        renderNudge();

        expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
      });
    });

    describe("when the session recorded no method at all", () => {
      /** @scenario "The passkey offer follows a password, not a federated sign-in" */
      it("says nothing rather than reading nothing as a password", () => {
        arriveWith("unknown");
        renderNudge();

        expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
      });
    });
  });
});
