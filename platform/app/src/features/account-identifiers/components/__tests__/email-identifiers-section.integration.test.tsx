/**
 * @vitest-environment jsdom
 *
 * The addresses an account can be reached at, on /settings/security.
 *
 * The guard's verdict comes down with the list, so every case here is "this
 * verdict in, this control out" — and the words on a stood-down control are
 * the registry's, never a sentence this screen wrote.
 *
 * Spec: specs/identity/authentication-settings.feature
 */

import { webcrypto } from "node:crypto";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  identifiersRef,
  confirmationRef,
  addMock,
  resendAddedMock,
  resendOwnMock,
  removeMock,
  completeMock,
  searchParamsRef,
} = vi.hoisted(() => ({
  identifiersRef: { current: [] as unknown[] },
  confirmationRef: {
    current: { email: "sam@acme.test", confirmed: true } as unknown,
  },
  addMock: vi.fn(),
  resendAddedMock: vi.fn(),
  resendOwnMock: vi.fn(),
  removeMock: vi.fn(),
  completeMock: vi.fn(),
  searchParamsRef: {
    current: new URLSearchParams("") as URLSearchParams | null,
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      identity: { myIdentifiers: { invalidate: vi.fn() } },
      auth: { myAddressConfirmation: { invalidate: vi.fn() } },
    }),
    identity: {
      myIdentifiers: {
        useQuery: () => ({ data: identifiersRef.current, isPending: false }),
      },
      addEmailIdentifier: {
        useMutation: () => ({ mutateAsync: addMock, isPending: false }),
      },
      resendIdentifierConfirmation: {
        useMutation: () => ({ mutateAsync: resendAddedMock, isPending: false }),
      },
      removeIdentifier: {
        useMutation: () => ({ mutateAsync: removeMock, isPending: false }),
      },
      completeVerification: {
        useMutation: () => ({ mutateAsync: completeMock, isPending: false }),
      },
      myMethodsLastUsed: {
        // No session evidence in these tests, which is the ordinary case the
        // rows have to render: absent means the row says nothing about use.
        useQuery: () => ({
          data: { byIdentifier: {}, secondFactorAt: null },
          isPending: false,
        }),
      },
    },
    auth: {
      myAddressConfirmation: {
        useQuery: () => ({ data: confirmationRef.current, isPending: false }),
      },
      sendMyAddressConfirmation: {
        useMutation: () => ({
          mutateAsync: resendOwnMock,
          mutate: resendOwnMock,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

import { refusalCopy } from "../../logic/refusalCopy";
import { EmailIdentifiersSection } from "../EmailIdentifiersSection";

// jsdom ships a `crypto` without `subtle`, and the ceremony's challenge is a
// SHA-256 digest — so the field a browser really has is put back.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const address = (overrides: Record<string, unknown>) => ({
  identifierId: "id_1",
  accountId: null,
  provider: "email",
  value: "sam@acme.test",
  isPrimary: false,
  confirmed: true,
  resendable: false,
  removable: true,
  refusalCode: null,
  demotesFirst: false,
  ...overrides,
});

const renderSection = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <EmailIdentifiersSection />
    </ChakraProvider>,
  );

const rows = () => screen.getAllByTestId("email-identifier-row");

describe("the account's email addresses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsRef.current = new URLSearchParams("");
    confirmationRef.current = { email: "sam@acme.test", confirmed: true };
    identifiersRef.current = [];
    addMock.mockResolvedValue({ identifierId: "id_new" });
    resendAddedMock.mockResolvedValue({ sent: true });
    resendOwnMock.mockResolvedValue({ sent: true });
    removeMock.mockResolvedValue({ removed: true });
    completeMock.mockResolvedValue({ verified: true });
    // The verifier is per-browser and the whole file shares one: a ceremony
    // started by an earlier case must not be the proof a later one finds.
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given one confirmed address and one that was never confirmed", () => {
    beforeEach(() => {
      identifiersRef.current = [
        address({ identifierId: "confirmed", isPrimary: true }),
        address({
          identifierId: "unconfirmed",
          value: "sam@other.test",
          confirmed: false,
          resendable: true,
        }),
      ];
    });

    /** @scenario Each email address says whether it has been confirmed */
    /** @scenario A second address is nudged, never gated */
    it("says which one has been confirmed and which has not", () => {
      renderSection();

      const [confirmed, unconfirmed] = rows();
      expect(within(confirmed!).getByTestId("address-confirmed")).toBeTruthy();
      expect(
        within(unconfirmed!).getByTestId("address-unconfirmed"),
      ).toBeTruthy();
    });

    /** @scenario An unconfirmed address offers to send its link again */
    /** @scenario A second address is nudged, never gated */
    it("offers to send the link again, and does not look the same afterwards", async () => {
      renderSection();

      const unconfirmed = rows()[1]!;
      fireEvent.click(within(unconfirmed).getByTestId("resend-address-link"));

      await waitFor(() => {
        expect(resendAddedMock).toHaveBeenCalledWith(
          expect.objectContaining({ identifierId: "unconfirmed" }),
        );
      });
      // A button that says the same thing after a click as before it is a
      // button nobody can tell worked.
      const sent = await screen.findByTestId("address-link-sent");
      expect(sent.textContent).toContain("sam@other.test");
    });

    /** @scenario A confirmed address offers nothing to resend */
    it("offers no resend on the confirmed one", () => {
      renderSection();

      const confirmed = rows()[0]!;
      expect(within(confirmed).queryByTestId("resend-address-link")).toBeNull();
    });

    /** @scenario An address nobody could have signed in with stays removable */
    it("keeps the unconfirmed one removable when the confirmed one is not", () => {
      identifiersRef.current = [
        address({
          identifierId: "confirmed",
          removable: false,
          refusalCode: "identity_detach_strands_user",
        }),
        address({
          identifierId: "unconfirmed",
          value: "sam@other.test",
          confirmed: false,
          resendable: true,
          removable: true,
        }),
      ];
      renderSection();

      const [confirmed, unconfirmed] = rows();
      expect(within(confirmed!).getByTestId("remove-address")).toHaveProperty(
        "disabled",
        true,
      );
      expect(within(unconfirmed!).getByTestId("remove-address")).toHaveProperty(
        "disabled",
        false,
      );
    });
  });

  describe("given the only confirmed way in is one address", () => {
    beforeEach(() => {
      identifiersRef.current = [
        address({
          identifierId: "only",
          removable: false,
          refusalCode: "identity_detach_strands_user",
        }),
      ];
    });

    /** @scenario Removing the last confirmed address is refused before it is clicked */
    it("stands Remove down and gives the guard's registered reason", () => {
      renderSection();

      expect(screen.getByTestId("remove-address")).toHaveProperty(
        "disabled",
        true,
      );
      // The stood-down control is wrapped so it can still carry a reason: a
      // disabled button receives no pointer events of its own.
      expect(screen.getByTestId("remove-address-blocked")).toBeTruthy();
      // And the reason is the registry's words for that code, through the one
      // function both stood-down surfaces read.
      const words = refusalCopy("identity_detach_strands_user");
      expect(words).toMatch(/no way back into your account/i);
      expect(words).toMatch(/add a verified email address first/i);
    });

    /** @scenario Removing the last confirmed address is refused before it is clicked */
    it("never sends the removal it stood down", () => {
      renderSection();
      fireEvent.click(screen.getByTestId("remove-address"));

      expect(removeMock).not.toHaveBeenCalled();
    });
  });

  describe("given one address and two passkeys", () => {
    /** @scenario Removing is refused where only passkeys and no address would be left */
    it("stands the address's Remove down, because nothing left could reach anybody", () => {
      identifiersRef.current = [
        address({
          identifierId: "address",
          removable: false,
          refusalCode: "identity_detach_strands_user",
        }),
      ];
      renderSection();

      expect(screen.getByTestId("remove-address")).toHaveProperty(
        "disabled",
        true,
      );
      expect(screen.getByTestId("remove-address-blocked")).toBeTruthy();
    });
  });

  describe("given the primary address is not the only confirmed one", () => {
    /** @scenario The primary address says it is demoted before it is removed */
    it("says another address becomes primary first", () => {
      identifiersRef.current = [
        address({
          identifierId: "primary",
          isPrimary: true,
          demotesFirst: true,
        }),
        address({ identifierId: "spare", value: "sam@other.test" }),
      ];
      renderSection();

      expect(rows()[0]!.textContent).toMatch(
        /makes another confirmed address primary/i,
      );
    });
  });

  describe("when another address is added", () => {
    /** @scenario Adding a second address starts a confirmation rather than a sign-in method */
    it("sends a confirmation and says the link is on its way", async () => {
      identifiersRef.current = [address({ identifierId: "existing" })];
      renderSection();

      fireEvent.click(screen.getByTestId("add-address"));
      fireEvent.change(screen.getByTestId("new-address"), {
        target: { value: "sam@other.test" },
      });
      fireEvent.click(screen.getByTestId("confirm-add-address"));

      await waitFor(() => {
        expect(addMock).toHaveBeenCalledWith(
          expect.objectContaining({ email: "sam@other.test" }),
        );
      });
      // The challenge travelled, which is what makes the emailed link
      // insufficient on its own.
      expect(addMock.mock.calls[0]![0].codeChallenge).toMatch(
        /^[A-Za-z0-9._~-]{43}$/,
      );
    });
  });

  describe("given a confirmation link opened in a browser that did not start it", () => {
    /** @scenario The confirmation link only completes where the ceremony was started */
    it("confirms nothing and says where to open it instead", async () => {
      searchParamsRef.current = new URLSearchParams(
        "confirm=id_new&verification=verif_1&token=tok_1",
      );
      renderSection();

      expect(await screen.findByTestId("address-wrong-browser")).toBeTruthy();
      expect(completeMock).not.toHaveBeenCalled();
    });
  });

  describe("given no identifiers yet and the account's own address", () => {
    /** @scenario Each email address says whether it has been confirmed */
    it("still says whether that address is confirmed, from the shell's own read", () => {
      identifiersRef.current = [];
      confirmationRef.current = { email: "sam@acme.test", confirmed: false };
      renderSection();

      expect(screen.getByTestId("address-unconfirmed")).toBeTruthy();
      expect(screen.getByTestId("resend-address-link")).toBeTruthy();
    });
  });
});
