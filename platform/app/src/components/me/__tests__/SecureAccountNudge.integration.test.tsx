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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SignedInWith = "password" | "passkey" | "federated" | "unknown";

const {
  nudgeRef,
  dismissMock,
  invalidateMock,
  cacheCalls,
  mountFetch,
  dismissal,
  cacheCancel,
} = vi.hoisted(() => {
  const nudgeRef = {
    current: {
      offer: true,
      passkey: true,
      twoStep: false,
      signedInWith: "password" as SignedInWith,
    },
  };
  // The refetch the dialog's own query starts when a page mounts it. It was
  // already in flight when the answer arrived, so its response carries the
  // offer the server had not been told about yet.
  const mountFetch = {
    isCancelled: false,
    land: () => {
      if (mountFetch.isCancelled) return;
      nudgeRef.current = { ...nudgeRef.current, offer: true };
    },
  };
  // The dismissal request, and TanStack Query's rule about which of its
  // callbacks survive. One given to `useMutation` runs whatever happened to
  // the component; one given to `mutate` is dropped when the observer is
  // gone by the time the server answers.
  type Callbacks =
    | { onSettled?: () => void; trpc?: { context?: Record<string, unknown> } }
    | undefined;
  const dismissal = {
    onMutation: undefined as Callbacks,
    onCall: undefined as Callbacks,
    settle: ({ isStillMounted }: { isStillMounted: boolean }) => {
      dismissal.onMutation?.onSettled?.();
      if (isStillMounted) dismissal.onCall?.onSettled?.();
    },
  };
  // The cache's own cancel waits for a refetch that may still be in flight.
  // Held open, it stands for the window in which a full page load carries
  // every request the document had not sent yet away with it.
  const cacheCancel = {
    gate: undefined as Promise<void> | undefined,
    hold: () => {
      cacheCancel.gate = new Promise<void>(() => undefined);
    },
    release: () => {
      cacheCancel.gate = undefined;
    },
  };
  return {
    nudgeRef,
    dismissMock: vi.fn(),
    invalidateMock: vi.fn(),
    cacheCalls: [] as string[],
    mountFetch,
    dismissal,
    cacheCancel,
  };
});

// The query cache is modelled rather than stubbed away: the dialog is mounted
// on every page, so what it renders after a navigation is decided by what the
// cache holds, and a mock that forgets writes cannot show that.
vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      user: {
        secureAccountNudge: {
          invalidate: invalidateMock,
          cancel: async () => {
            cacheCalls.push("cancel");
            mountFetch.isCancelled = true;
            await cacheCancel.gate;
          },
          setData: (
            _input: unknown,
            updater: (
              previous: typeof nudgeRef.current,
            ) => typeof nudgeRef.current,
          ) => {
            cacheCalls.push("setData");
            nudgeRef.current = updater(nudgeRef.current);
          },
        },
      },
    }),
    user: {
      secureAccountNudge: { useQuery: () => ({ data: nudgeRef.current }) },
      dismissSecureAccountNudge: {
        useMutation: (options?: {
          onSettled?: () => void;
          trpc?: { context?: Record<string, unknown> };
        }) => {
          dismissal.onMutation = options;
          return {
            mutate: (input: unknown, perCall?: { onSettled?: () => void }) => {
              dismissal.onCall = perCall;
              dismissMock(input);
            },
            isPending: false,
          };
        },
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
    cacheCalls.length = 0;
    mountFetch.isCancelled = false;
    dismissal.onMutation = undefined;
    dismissal.onCall = undefined;
    cacheCancel.release();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given somebody who answered the offer with Not now", () => {
    describe("when the next page mounts the dialog again", () => {
      /** @scenario "A dismissal is remembered on the next page, not just in the dialog" */
      it("stays closed, because the answer reached the cached offer too", async () => {
        renderNudge();
        fireEvent.click(screen.getByRole("button", { name: "Not now" }));

        await waitFor(() => {
          expect(dismissMock).toHaveBeenCalled();
        });
        // The dialog closing is local state; this is the part that survives a
        // navigation. `setUpTwoStep` navigates straight after answering, so
        // without it the offer reappears over the page it sent them to.
        cleanup();
        renderNudge();

        expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
      });
    });

    describe("when a fetch that started before the answer lands after it", () => {
      /** @scenario "A dismissal is remembered on the next page, not just in the dialog" */
      it("stays closed, because that fetch was cancelled before the answer was written", async () => {
        renderNudge();
        fireEvent.click(screen.getByRole("button", { name: "Not now" }));

        await waitFor(() => {
          expect(dismissMock).toHaveBeenCalled();
        });
        mountFetch.land();

        cleanup();
        renderNudge();

        expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
        expect(cacheCalls).toEqual(["cancel", "setData"]);
      });
    });

    /**
     * The cache is gone on a full page load, so the account write is the only
     * part of the answer the next document can read. It used to be sent LAST,
     * behind an awaited cache cancel that waits on a refetch still in flight —
     * and an end-to-end run caught the consequence: the request was never sent
     * at all, the server was never told, and the offer came back as a modal
     * over the settings page somebody had just been sent to.
     */
    describe("when the page goes away before the cache work finishes", () => {
      /** @scenario "A dismissal is remembered on the next page, not just in the dialog" */
      it("has already told the account, because the write waits for nothing", async () => {
        cacheCancel.hold();
        renderNudge();

        fireEvent.click(screen.getByRole("button", { name: "Not now" }));

        await waitFor(() => {
          expect(dismissMock).toHaveBeenCalled();
        });
        // Still parked inside the cancel: the write went out ahead of it.
        expect(cacheCalls).toEqual(["cancel"]);
        // Sent so it outlives the document as well. Being sent first is not
        // enough on its own: the browser cancels everything still in flight
        // when a page goes away, and an end-to-end run showed the answer lost
        // in exactly that window, a few milliseconds wide.
        expect(dismissal.onMutation?.trpc?.context?.keepalive).toBe(true);
      });
    });

    describe("when the dismissal settles after the dialog has left the tree", () => {
      /** @scenario "A dismissal is remembered on the next page, not just in the dialog" */
      it("still refreshes the offer from the server", async () => {
        renderNudge();
        fireEvent.click(screen.getByRole("button", { name: "Not now" }));

        await waitFor(() => {
          expect(dismissMock).toHaveBeenCalled();
        });
        // The answer writes `offer: false`, and that cached offer is what
        // renders the dialog, so the component holding the mutation is gone
        // before the server replies. Only a callback on the mutation itself
        // is left to reconcile the optimistic write.
        cleanup();
        dismissal.settle({ isStillMounted: false });

        expect(invalidateMock).toHaveBeenCalled();
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
