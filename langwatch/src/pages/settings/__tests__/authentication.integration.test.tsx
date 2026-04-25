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
    it("does not render the form by default — only a Change Password button next to the linked identity", () => {
      renderPage();
      expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: /Change Password/i }),
      ).toBeTruthy();
    });

    describe("when the user clicks Change Password", () => {
      it("opens the dialog with no Current Password field, calls api.user.changePassword, and closes on success", async () => {
        mockChangePassword.mockResolvedValue({ success: true });
        renderPage();

        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });
        // Dialog now visible
        await waitFor(() => {
          expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
        });
        expect(screen.queryByLabelText(/Current Password/i)).toBeNull();

        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "new-pw-123456" },
        });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
          target: { value: "new-pw-123456" },
        });
        // Click the submit button inside the dialog (the only "Change
        // Password" button visible while the dialog is open).
        await act(async () => {
          const submitBtns = screen
            .getAllByRole("button", { name: /Change Password/i })
            .filter((b) => (b as HTMLButtonElement).type === "submit");
          fireEvent.click(submitBtns[0]!);
        });

        await waitFor(() => {
          expect(mockChangePassword).toHaveBeenCalledWith(
            expect.objectContaining({ newPassword: "new-pw-123456" }),
          );
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
    });

    describe("when the linked identity is a social provider via auth0 (e.g. google-oauth2|...)", () => {
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
      it("shows the Current Password field too", async () => {
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
