/**
 * @vitest-environment jsdom
 *
 * Integration tests for the /settings/security page — verifying that
 * the Change Password entry point is gated correctly and that opening it
 * surfaces the dialog with the right shape (Current Password field shown
 * for email/credential mode, hidden for Auth0 mode).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockChangePassword,
  mockUnlinkAccount,
  mockToasterCreate,
  publicEnvRef,
  linkedAccountsRef,
} = vi.hoisted(() => ({
  mockChangePassword: vi.fn(),
  mockUnlinkAccount: vi.fn(),
  mockToasterCreate: vi.fn(),
  publicEnvRef: {
    current: { NEXTAUTH_PROVIDER: "auth0" } as Record<string, unknown>,
  },
  linkedAccountsRef: {
    current: [
      {
        id: "acc-1",
        provider: "auth0",
        providerAccountId: "auth0|user-123",
      },
    ] as Array<{ id: string; provider: string; providerAccountId: string }>,
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      user: {
        getLinkedAccounts: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
      // The page also renders the email-addresses section, which invalidates
      // both reads after every change it makes.
      identity: {
        myIdentifiers: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
      auth: {
        myAddressConfirmation: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    }),
    // The addresses section and the sign-in-methods list both read the
    // account's identifiers: one to draw them, the other to know whether the
    // detach guard would refuse an unlink. Empty here — this file is about the
    // password dialog, and those two have their own tests.
    identity: {
      myIdentifiers: { useQuery: () => ({ data: [], isPending: false }) },
      // When each method last got somebody in. Answered empty here: this file
      // is about the password dialog, and the addresses band has its own tests.
      myMethodsLastUsed: {
        useQuery: () => ({ data: undefined, isPending: false }),
      },
      addEmailIdentifier: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      resendIdentifierConfirmation: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      removeIdentifier: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      completeVerification: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    auth: {
      myAddressConfirmation: {
        useQuery: () => ({
          data: { email: "user@example.com", confirmed: true },
          isPending: false,
        }),
      },
      sendMyAddressConfirmation: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
    user: {
      getLinkedAccounts: {
        useQuery: () => ({
          data: linkedAccountsRef.current,
          isLoading: false,
        }),
      },
      getSsoStatus: {
        useQuery: () => ({
          data: { pendingSsoSetup: false },
        }),
      },
      hasPassword: {
        useQuery: () => ({ data: { hasPassword: true }, isPending: false }),
      },
      changePassword: {
        useMutation: () => ({
          mutateAsync: mockChangePassword,
          isPending: false,
        }),
      },
      setPassword: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue(undefined),
          isPending: false,
        }),
      },
      unlinkAccount: {
        useMutation: () => ({
          mutateAsync: mockUnlinkAccount,
          isLoading: false,
        }),
      },
    },
    // The page also renders TwoFactorSection (D06). It gates itself on the
    // public env, but its query is declared before that gate — hooks run in
    // order — so the mock has to answer it however the flag is set.
    twoStepVerification: {
      account: {
        useQuery: () => ({
          data: undefined,
          isPending: false,
          refetch: vi.fn(),
        }),
      },
      disable: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => mockToasterCreate(...args) },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: publicEnvRef.current,
  }),
}));

// The page also renders EnterpriseCapabilitiesSection, whose plan lookup would
// otherwise reach for `api.limits` that this file's api mock does not carry.
// That section has its own tests; here it only has to not throw.
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: false, isLoading: false }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { ssoProvider: null },
  }),
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { email: "user@example.com" } },
  }),
  linkAccount: vi.fn(),
  // The passkey and two-step sections both reach the auth client, and both
  // call it before their own flag gate — a hook cannot be conditional. So the
  // double has to answer even on a deployment where neither is offered.
  authClient: {
    useListPasskeys: () => ({ data: [], isPending: false }),
    twoFactor: {
      enable: vi.fn(),
      verifyTotp: vi.fn(),
      generateBackupCodes: vi.fn(),
    },
  },
}));

vi.mock("~/components/SettingsLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import SecuritySettings from "../security";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SecuritySettings />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockChangePassword.mockReset();
  mockUnlinkAccount.mockReset();
  mockToasterCreate.mockReset();
  publicEnvRef.current = { NEXTAUTH_PROVIDER: "auth0" };
  linkedAccountsRef.current = [
    {
      id: "acc-1",
      provider: "auth0",
      providerAccountId: "auth0|user-123",
    },
  ];
});

afterEach(() => {
  cleanup();
});

describe("<SecuritySettings/>", () => {
  describe("the page's own shape", () => {
    it("names the page and says in one line what it governs", () => {
      renderPage();

      expect(screen.getByRole("heading", { name: "Security" })).toBeTruthy();
      expect(screen.getByText(/if you lost one of them/i)).toBeTruthy();
    });

    /** @scenario The page is four sections, one per subject */
    it("lays the bands out in the order the page argues for", () => {
      // Everything mounted, so the order is the whole order rather than
      // whatever this deployment happens to offer.
      publicEnvRef.current = {
        NEXTAUTH_PROVIDER: "email",
        PASSKEYS_ENABLED: true,
        MFA_ENROLLMENT_OPEN: true,
      };
      const { container } = renderPage();

      const sections = Array.from(
        container.querySelectorAll("[data-testid$='-settings-section']"),
      ).map((section) => section.getAttribute("data-testid"));

      expect(sections).toEqual([
        "email-and-linked-accounts-settings-section",
        "passkeys-settings-section",
        "two-factor-settings-section",
        "password-settings-section",
      ]);
    });

    /** @scenario Email addresses and linked accounts sit under one heading */
    it("keeps the addresses, the providers and one action row inside the one band", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
      renderPage();

      const band = screen.getByTestId(
        "email-and-linked-accounts-settings-section",
      );
      expect(
        within(band).getByTestId("email-identifiers-section"),
      ).toBeTruthy();
      expect(within(band).getByTestId("linked-accounts-section")).toBeTruthy();

      // One action row: adding an address and connecting a provider are the
      // same offer, so they share a line rather than stacking as two. Asserted
      // on the row itself rather than on how many parents up it happens to be,
      // which is a fact about the flexbox and not about the offer.
      const row = within(band).getByTestId("identifier-action-row");
      expect(within(row).getByTestId("add-address")).toBeTruthy();
      expect(within(row).getByTestId("link-method-google")).toBeTruthy();
    });

    /**
     * The layout pop this row was reported for: opening the field used to
     * replace the button with a much wider input, and every Connect button
     * slid sideways out from under the cursor that had just pressed it.
     */
    /** @scenario Email addresses and linked accounts sit under one heading */
    it("leaves the connect buttons where they were when the address field opens", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
      renderPage();

      const band = screen.getByTestId(
        "email-and-linked-accounts-settings-section",
      );
      const row = within(band).getByTestId("identifier-action-row");
      const before = within(row)
        .getAllByRole("button")
        .map((b) => b.textContent);

      fireEvent.click(within(band).getByTestId("add-address"));

      // The field opened somewhere, and it did not open in this row.
      expect(within(band).getByTestId("new-address")).toBeTruthy();
      expect(within(row).queryByTestId("new-address")).toBeNull();
      expect(
        within(row)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(before);
    });
  });

  describe("when the account is down to one way in", () => {
    /** @scenario An account with one way in is told so, where the remedy is */
    it("says so inside the band whose halves are the remedy", () => {
      publicEnvRef.current = {
        NEXTAUTH_PROVIDER: "email",
        PASSKEYS_ENABLED: true,
        MFA_ENROLLMENT_OPEN: true,
      };
      // A password and nothing else: no passkey, no linked account.
      linkedAccountsRef.current = [
        {
          id: "acc-password",
          provider: "credential",
          providerAccountId: "user@example.com",
        },
      ];
      renderPage();

      const band = screen.getByTestId("passkeys-settings-section");
      const notice = within(band).getByTestId("last-way-in-notice");
      expect(notice.textContent).toMatch(/only way into this account/i);
      expect(
        within(notice).getByText(/only way into this account/i).dataset.case,
      ).toBe("only-password");
    });

    /** @scenario An account with more than one way in is told nothing */
    it("says nothing at all once a second way in exists", () => {
      publicEnvRef.current = {
        NEXTAUTH_PROVIDER: "email",
        PASSKEYS_ENABLED: true,
        MFA_ENROLLMENT_OPEN: true,
      };
      linkedAccountsRef.current = [
        {
          id: "acc-password",
          provider: "credential",
          providerAccountId: "user@example.com",
        },
        {
          id: "acc-google",
          provider: "google",
          providerAccountId: "google-id",
        },
      ];
      renderPage();

      expect(screen.queryByTestId("last-way-in-notice")).toBeNull();
    });
  });

  describe("when NEXTAUTH_PROVIDER is auth0 with an Email/Password (auth0 db) identity", () => {
    /** @scenario Auth0 user with a database identity sees the Change Password link in their linked sign-in row */
    it("does not render the form by default — only a Change Password button next to the linked identity", () => {
      renderPage();
      expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /Change Password/i }),
      ).toBeTruthy();
    });

    describe("when the user clicks Change Password", () => {
      /** @scenario The dialog asks for current + new password in both modes */
      /** @scenario Successful change shows a toast and closes the dialog */
      it("opens the dialog with Current + New + Confirm, calls api.user.changePassword with both passwords, and closes on success", async () => {
        mockChangePassword.mockResolvedValue({ success: true });
        renderPage();

        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        // Dialog now visible — and includes Current Password (re-verified
        // server-side via Auth0 ROPG).
        await waitFor(() => {
          expect(screen.getByLabelText(/Current Password/i)).toBeTruthy();
        });
        expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
        expect(screen.getByLabelText(/Confirm New Password/i)).toBeTruthy();

        fireEvent.change(screen.getByLabelText(/Current Password/i), {
          target: { value: "old-pw-123" },
        });
        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "new-pw-123456" },
        });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
          target: { value: "new-pw-123456" },
        });
        await act(async () => {
          const submitBtns = screen
            .getAllByRole("button", { name: /Change Password/i })
            .filter((b) => (b as HTMLButtonElement).type === "submit");
          fireEvent.click(submitBtns[0]!);
        });

        await waitFor(() => {
          expect(mockChangePassword).toHaveBeenCalledTimes(1);
        });
        expect(mockChangePassword.mock.calls[0]?.[0]).toEqual({
          currentPassword: "old-pw-123",
          newPassword: "new-pw-123456",
        });
        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Password changed successfully",
              type: "success",
            }),
          );
        });
        // Dialog closes — the new-password field is gone again.
        await waitFor(() => {
          expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
        });
      });

      /** @scenario Wrong current password keeps the dialog open and shows an error */
      it("keeps the dialog open and shows the error toast when the server rejects the current password", async () => {
        // Shaped like the real rejection, not a bare Error: `user.changePassword`
        // throws a 401 `TRPCError` whose message it wrote for the user, and the
        // boundary stamps `data.authored` to say so (see `readAuthoredMessage`).
        // That flag is what keeps the specific reason on screen now that #5984
        // stopped the client rendering `error.message` on its own say-so.
        mockChangePassword.mockRejectedValue({
          message: "Current password is incorrect",
          data: { httpStatus: 401, authored: true },
        });
        renderPage();

        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        await waitFor(() => {
          expect(screen.getByLabelText(/Current Password/i)).toBeTruthy();
        });
        fireEvent.change(screen.getByLabelText(/Current Password/i), {
          target: { value: "wrong-pw" },
        });
        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "new-pw-123456" },
        });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
          target: { value: "new-pw-123456" },
        });
        await act(async () => {
          const submitBtns = screen
            .getAllByRole("button", { name: /Change Password/i })
            .filter((b) => (b as HTMLButtonElement).type === "submit");
          fireEvent.click(submitBtns[0]!);
        });

        // The headline is the call site's `fallbackTitle`; the body is the
        // sentence the procedure authored, which is the whole point of this
        // case — the user has to be told WHICH password was wrong.
        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Couldn't change your password",
              description: "Current password is incorrect",
              type: "error",
            }),
          );
        });
        // Dialog stays open so the user can retry — the form is still in the DOM.
        expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
      });

      /** @scenario Server error keeps the dialog open and shows the error */
      it("keeps the dialog open and shows the error toast on a generic server error", async () => {
        mockChangePassword.mockRejectedValue(
          new Error("Auth0 is not authorized to update users."),
        );
        renderPage();

        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        await waitFor(() => {
          expect(screen.getByLabelText(/Current Password/i)).toBeTruthy();
        });
        fireEvent.change(screen.getByLabelText(/Current Password/i), {
          target: { value: "old-pw-123" },
        });
        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "new-pw-123456" },
        });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
          target: { value: "new-pw-123456" },
        });
        await act(async () => {
          const submitBtns = screen
            .getAllByRole("button", { name: /Change Password/i })
            .filter((b) => (b as HTMLButtonElement).type === "submit");
          fireEvent.click(submitBtns[0]!);
        });

        // The mirror of the case above: this rejection carries no
        // `data.authored`, and neither does a real one — the procedure raises
        // this as a 500, and the boundary never marks a 5xx authored (its
        // message names Auth0 scopes and env vars, which is an operator's
        // detail, not a customer's). So it degrades to the call site's
        // headline plus the generic body, never the server's own words. Don't
        // restore an `error.message` assertion here; relaying it was the
        // #5984 bug.
        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Couldn't change your password",
              description: "We've been notified. Try again in a moment.",
              type: "error",
            }),
          );
        });
        expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
      });

      /** @scenario Cancel button closes the dialog without submitting */
      it("closes the dialog without calling the mutation when Cancel is clicked", async () => {
        renderPage();

        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        await waitFor(() => {
          expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
        });
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
        });

        await waitFor(() => {
          expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
        });
        expect(mockChangePassword).not.toHaveBeenCalled();
      });

      /** @scenario Reopening the dialog clears any previously-typed values */
      it("clears the form when the dialog is reopened", async () => {
        renderPage();

        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        await waitFor(() => {
          expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
        });
        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "leftover-value" },
        });
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
        });
        await waitFor(() => {
          expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
        });

        // Reopen
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        await waitFor(() => {
          expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
        });
        const newPasswordInput = screen.getByLabelText(
          /^New Password$/i,
        ) as HTMLInputElement;
        expect(newPasswordInput.value).toBe("");
      });
    });

    /** @scenario Auth0 social-only user (Google via Auth0) does not see Change Password */
    describe("when the linked identity is a social provider via auth0 (e.g. google-oauth2|...)", () => {
      /** @scenario Auth0 social-only user (Google via Auth0) does not see Change Password */
      it("does not show the Change Password button (no password to update)", () => {
        linkedAccountsRef.current = [
          {
            id: "acc-google",
            provider: "auth0",
            providerAccountId: "google-oauth2|abc",
          },
        ];
        renderPage();
        expect(
          screen.queryByRole("button", { name: /Change Password/i }),
        ).toBeNull();
      });
    });
  });

  describe("when NEXTAUTH_PROVIDER is email", () => {
    /** @scenario Email/credential user sees a dedicated Change Password section with just a button */
    it("renders a dedicated Change Password section with a button (no inline form)", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
      renderPage();
      expect(
        screen.getByRole("button", { name: /Change Password/i }),
      ).toBeTruthy();
      // The form fields are NOT visible until the dialog opens.
      expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
    });

    describe("when the dialog is opened", () => {
      it("shows Current + New + Confirm Password fields", async () => {
        publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
        renderPage();
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        await waitFor(() => {
          expect(screen.getByLabelText(/Current Password/i)).toBeTruthy();
        });
        expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
        expect(screen.getByLabelText(/Confirm New Password/i)).toBeTruthy();
      });
    });
  });

  describe("when NEXTAUTH_PROVIDER is a different oauth provider (e.g. google)", () => {
    it("does not render the Change Password entry point", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "google" };
      linkedAccountsRef.current = [
        {
          id: "acc-google",
          provider: "google",
          providerAccountId: "google-id",
        },
      ];
      renderPage();
      expect(
        screen.queryByRole("button", { name: /Change Password/i }),
      ).toBeNull();
    });
  });
});
