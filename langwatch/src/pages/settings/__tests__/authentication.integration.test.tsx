/**
 * @vitest-environment jsdom
 *
 * Integration tests for the /settings/authentication page — specifically
 * that the Change Password form renders (and submits to
 * api.user.changePassword) for tenants configured with
 * NEXTAUTH_PROVIDER="auth0", not just "email".
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

// SettingsLayout pulls in DashboardLayout → lots of dependencies. For a
// focused page-content test, replace it with a pass-through wrapper.
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
});

afterEach(() => {
  cleanup();
});

describe("<AuthenticationSettings/>", () => {
  describe("when NEXTAUTH_PROVIDER is auth0", () => {
    it("renders the Change Password form without a Current Password field", () => {
      renderPage();
      expect(
        screen.getByRole("button", { name: /Change Password/i }),
      ).toBeTruthy();
      expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
      expect(screen.getByLabelText(/Confirm New Password/i)).toBeTruthy();
      // Auth0 mode trusts the session; current password is not asked.
      expect(screen.queryByLabelText(/Current Password/i)).toBeNull();
    });

    describe("when the user submits a valid new password and confirmation", () => {
      it("calls api.user.changePassword with only newPassword", async () => {
        mockChangePassword.mockResolvedValue({ success: true });
        renderPage();

        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "new-pw-123456" },
        });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
          target: { value: "new-pw-123456" },
        });
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
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
      });
    });

    describe("when the server returns an error", () => {
      it("shows an error toast", async () => {
        mockChangePassword.mockRejectedValue(
          new Error(
            "Auth0 is not authorized to update users. Ask an administrator to enable the update:users scope on the Auth0 application.",
          ),
        );
        renderPage();

        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "new-pw-123456" },
        });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
          target: { value: "new-pw-123456" },
        });
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });

        await waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Failed to change password",
              type: "error",
            }),
          );
        });
      });
    });

    describe("when new password and confirmation do not match", () => {
      it("shows a client-side validation error and does not call the mutation", async () => {
        renderPage();

        fireEvent.change(screen.getByLabelText(/^New Password$/i), {
          target: { value: "new-pw-123456" },
        });
        fireEvent.change(screen.getByLabelText(/Confirm New Password/i), {
          target: { value: "different-1234" },
        });
        await act(async () => {
          fireEvent.click(
            screen.getByRole("button", { name: /Change Password/i }),
          );
        });

        await waitFor(() => {
          expect(screen.getByText(/Passwords don't match/i)).toBeTruthy();
        });
        expect(mockChangePassword).not.toHaveBeenCalled();
      });
    });
  });

  describe("when NEXTAUTH_PROVIDER is a different oauth provider (e.g. google)", () => {
    it("does not render the Change Password form", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "google" };
      renderPage();
      expect(screen.queryByLabelText(/Current Password/i)).toBeNull();
      expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
    });
  });

  describe("when NEXTAUTH_PROVIDER is email", () => {
    it("renders the form including the Current Password field (regression)", () => {
      publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
      renderPage();
      expect(screen.getByLabelText(/Current Password/i)).toBeTruthy();
      expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
    });
  });
});
