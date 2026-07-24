/**
 * @vitest-environment jsdom
 *
 * Integration tests for the /settings/authentication page — verifying that
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
    current: { NEXTAUTH_PROVIDER: "auth0" as string | undefined },
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
    useContext: () => ({
      user: {
        getLinkedAccounts: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
    }),
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
      changePassword: {
        useMutation: () => ({
          mutateAsync: mockChangePassword,
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
}));

vi.mock("~/components/SettingsLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import AuthenticationSettings from "../authentication";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AuthenticationSettings />
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

describe("<AuthenticationSettings/>", () => {
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
        mockChangePassword.mockRejectedValue(
          new Error("Current password is incorrect"),
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

        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Failed to change password",
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

        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Failed to change password",
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
