/**
 * @vitest-environment jsdom
 *
 * The password, in the section it got when it stopped sharing one with the
 * linked accounts.
 *
 * Three states matter here: no password (set a first one), a password that can
 * be given up (change or remove), and a password the detach guard will not let
 * go of (removal stood down, in the guard's own registered words).
 *
 * Spec: specs/identity/authentication-settings.feature
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

const {
  accountsRef,
  identifiersRef,
  hasPasswordRef,
  publicEnvRef,
  unlinkMock,
} = vi.hoisted(() => ({
  accountsRef: { current: [] as unknown[] },
  identifiersRef: { current: [] as unknown[] },
  hasPasswordRef: { current: true },
  publicEnvRef: { current: { NEXTAUTH_PROVIDER: "email" } as unknown },
  unlinkMock: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      user: {
        getLinkedAccounts: { invalidate: vi.fn() },
        hasPassword: { invalidate: vi.fn() },
      },
      identity: { myIdentifiers: { invalidate: vi.fn() } },
    }),
    user: {
      getLinkedAccounts: {
        useQuery: () => ({ data: accountsRef.current, isLoading: false }),
      },
      hasPassword: {
        useQuery: () => ({
          data: { hasPassword: hasPasswordRef.current },
          isPending: false,
        }),
      },
      unlinkAccount: {
        useMutation: () => ({ mutateAsync: unlinkMock, isPending: false }),
      },
      // The dialog renders alongside the buttons; it is not what these
      // scenarios are about, so its mutations are present and inert.
      changePassword: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      setPassword: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    identity: {
      myIdentifiers: {
        useQuery: () => ({ data: identifiersRef.current, isPending: false }),
      },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import { PasswordSection } from "../PasswordSection";

const renderSection = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <PasswordSection />
    </ChakraProvider>,
  );

const passwordAccount = {
  id: "acct_password",
  provider: "credential",
  providerAccountId: "sam@acme.test",
};

const identifier = (overrides: Record<string, unknown>) => ({
  identifierId: "id_password",
  accountId: "acct_password",
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

describe("the password section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unlinkMock.mockResolvedValue(undefined);
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
    hasPasswordRef.current = true;
    accountsRef.current = [passwordAccount];
    identifiersRef.current = [
      identifier({}),
      identifier({
        identifierId: "id_other",
        accountId: "acct_other",
        value: "sam@other.test",
      }),
    ];
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an account that signs in without a password", () => {
    /** @scenario An account with no password is offered one rather than a change */
    it("offers to set a first one, and nothing to remove", () => {
      hasPasswordRef.current = false;
      accountsRef.current = [];
      renderSection();

      expect(screen.getByTestId("password-action").textContent).toMatch(
        /Set a password/i,
      );
      expect(screen.queryByTestId("remove-password")).toBeNull();
    });
  });

  describe("given a password and another confirmed way in", () => {
    /** @scenario The password and the linked accounts are separate sections */
    it("offers changing it and giving it up, with no linked account in sight", () => {
      renderSection();

      expect(screen.getByTestId("password-action").textContent).toMatch(
        /Change Password/i,
      );
      expect(screen.getByTestId("remove-password")).toHaveProperty(
        "disabled",
        false,
      );
      expect(screen.queryByTestId("linked-account-row")).toBeNull();
    });

    describe("when the password is removed", () => {
      /** @scenario Removing the password asks first and says what stays */
      it("asks first, names what stays, and removes only once answered", async () => {
        renderSection();

        fireEvent.click(screen.getByTestId("remove-password"));

        const dialog = await screen.findByTestId("unlink-method-dialog");
        expect(dialog.textContent).toContain("sam@other.test");
        expect(unlinkMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId("confirm-unlink-method"));

        await waitFor(() => {
          expect(unlinkMock).toHaveBeenCalledWith({
            accountId: "acct_password",
          });
        });
      });
    });
  });

  describe("given the password is the only confirmed way in", () => {
    /** @scenario Removing the password is refused before it is clicked where it is the last way in */
    it("stands the removal down and says why in the guard's words", () => {
      identifiersRef.current = [
        identifier({
          removable: false,
          refusalCode: "identity_detach_strands_user",
        }),
      ];
      renderSection();

      expect(screen.getByTestId("remove-password")).toHaveProperty(
        "disabled",
        true,
      );
      expect(screen.getByTestId("remove-password-blocked")).toBeTruthy();
    });
  });

  describe("given a deployment that authenticates somewhere else entirely", () => {
    it("renders nothing, because there is no password here to change", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "google" };
      accountsRef.current = [
        { id: "acct_google", provider: "google", providerAccountId: "g|sam" },
      ];
      const { container } = renderSection();

      expect(container.querySelector("section")).toBeNull();
    });
  });

  describe("given an Auth0 account with no database identity", () => {
    it("renders nothing, because the password it would change does not exist", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "auth0" };
      accountsRef.current = [
        {
          id: "acct_social",
          provider: "auth0",
          providerAccountId: "google-oauth2|sam",
        },
      ];
      const { container } = renderSection();

      expect(container.querySelector("section")).toBeNull();
    });
  });
});
