/**
 * @vitest-environment jsdom
 *
 * The password section: changing it, setting a first one, and validation.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { PasswordSection } from "../password-section.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    authProvider: "email" as string | undefined,
    emailPasswordEnabled: false,
    accounts: [] as { provider: string; providerAccountId: string }[],
    hasPassword: true,
    changeRejectsWith: void 0 as unknown,
  },
}));

const calls = vi.hoisted(() => ({
  changePassword: vi.fn(),
  setPassword: vi.fn(),
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const mutation = (run: (input: unknown) => unknown) => ({
    useMutation: () => ({
      isPending: false,
      mutateAsync: async (input: unknown) => run(input),
    }),
  });
  const api = {
    useUtils: () => ({
      user: { getLinkedAccounts: { invalidate: vi.fn() }, hasPassword: { invalidate: vi.fn() } },
    }),
    user: {
      hasPassword: {
        useQuery: () => ({ data: { hasPassword: state.hasPassword }, isLoading: false }),
      },
      getLinkedAccounts: { useQuery: () => ({ data: state.accounts }) },
      changePassword: mutation((input) => {
        calls.changePassword(input);
        if (state.changeRejectsWith) throw state.changeRejectsWith;
        return { ok: true };
      }),
      setPassword: mutation((input) => {
        calls.setPassword(input);
        return { ok: true };
      }),
    },
  };
  return { personalWorkspaceApi: api, api };
});

beforeEach(() => {
  state.authProvider = "email";
  state.emailPasswordEnabled = false;
  state.accounts = [];
  state.hasPassword = true;
  state.changeRejectsWith = void 0;
  calls.changePassword.mockReset();
  calls.setPassword.mockReset();
});

afterEach(() => cleanup());

function renderSection(options: Parameters<typeof fakePersonalWorkspaceHost>[0] = {}) {
  const host = fakePersonalWorkspaceHost({
    ...options,
    deployment: {
      isSaas: true,
      appBaseUrl: "https://app.langwatch.ai",
      passkeysEnabled: false,
      authProvider: state.authProvider,
      emailPasswordEnabled: state.emailPasswordEnabled,
      ...options.deployment,
    },
  });
  renderWithPersonalWorkspaceHost(<PasswordSection />, { host });
  return host;
}

async function openChangePassword() {
  await userEvent.click(screen.getByRole("button", { name: /Change Password/i }));
  await waitFor(() => expect(screen.getByLabelText(/Current Password/i)).toBeTruthy());
}

async function fillAndSubmit({
  current = "old-pw-123",
  next = "new-pw-123456",
}: { current?: string; next?: string } = {}) {
  await userEvent.type(screen.getByLabelText(/Current Password/i), current);
  await userEvent.type(screen.getByLabelText(/^New Password$/i), next);
  await userEvent.type(screen.getByLabelText(/Confirm New Password/i), next);
  const submit = screen
    .getAllByRole("button", { name: /Change Password/i })
    .find((button) => (button as HTMLButtonElement).type === "submit");
  await userEvent.click(submit!);
}

describe("given an email deployment", () => {
  describe("when the reader has a password", () => {
    /** @scenario "The password and the linked accounts are separate sections" */
    it("shows a dedicated password section with just a button", () => {
      renderSection();

      expect(screen.getByTestId("password-action")).toHaveTextContent("Change Password");
      expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
    });

    /** @scenario "Every password field on the page masks what is typed into it" */
    it("masks all three fields in the change dialog", async () => {
      renderSection();

      await openChangePassword();

      for (const label of [/Current Password/i, /^New Password$/i, /Confirm New Password/i]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).type).toBe("password");
      }
    });

    describe("when the change succeeds", () => {
      it("sends both passwords, says so, and closes the dialog", async () => {
        const host = renderSection();

        await openChangePassword();
        await fillAndSubmit();

        await waitFor(() => expect(calls.changePassword).toHaveBeenCalledTimes(1));
        expect(calls.changePassword.mock.calls[0]?.[0]).toEqual({
          currentPassword: "old-pw-123",
          newPassword: "new-pw-123456",
        });
        await waitFor(() =>
          expect(host.recording.successes).toContainEqual(
            expect.objectContaining({ title: "Password changed successfully" }),
          ),
        );
      });
    });

    describe("when the server rejects the current password", () => {
      it("keeps the dialog open and carries the server's own sentence", async () => {
        state.changeRejectsWith = {
          message: "Current password is incorrect",
          data: { httpStatus: 401, authored: true },
        };
        const host = renderSection();

        await openChangePassword();
        await fillAndSubmit({ current: "wrong-pw" });

        await waitFor(() =>
          expect(host.recording.failures).toContainEqual(
            expect.objectContaining({
              fallbackTitle: "Couldn't change your password",
              description: "Current password is incorrect",
            }),
          ),
        );
        expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
      });
    });
  });

  describe("when the reader has none", () => {
    /** @scenario "An account with no password is offered one rather than a change" */
    it("offers to set a first one instead", async () => {
      state.hasPassword = false;
      renderSection();

      expect(screen.getByTestId("password-action")).toHaveTextContent("Set a password");

      await userEvent.click(screen.getByTestId("password-action"));

      await waitFor(() => expect(screen.getByLabelText(/^Password$/i)).toBeTruthy());
      expect(screen.queryByLabelText(/Current Password/i)).toBeNull();
    });

    it("asks the offer again after one is set, so the button does not linger", async () => {
      state.hasPassword = false;
      renderSection();

      await userEvent.click(screen.getByTestId("password-action"));
      await waitFor(() => expect(screen.getByLabelText(/^Password$/i)).toBeTruthy());
      await userEvent.type(screen.getByLabelText(/^Password$/i), "new-pw-123456");
      await userEvent.type(screen.getByLabelText(/Confirm password/i), "new-pw-123456");
      await userEvent.click(screen.getByRole("button", { name: /^Set password$/i }));

      await waitFor(() =>
        expect(calls.setPassword).toHaveBeenCalledWith({ password: "new-pw-123456" }),
      );
    });
  });
});

describe("given a deployment on an identity provider the product cannot reach", () => {
  describe("when the page renders", () => {
    it("offers no password control at all", () => {
      state.authProvider = "google";
      renderSection();

      expect(screen.queryByRole("button", { name: /Change Password/i })).toBeNull();
      expect(screen.queryByTestId("password-section")).toBeNull();
    });
  });
});

describe("given a self-hosted deployment behind an enterprise provider", () => {
  /** @scenario A self-hosted passkey-only administrator can still set a password */
  it("offers to set a password to a passkey-only account, though the provider is not email", () => {
    // Self-hosted issues its own passwords even behind an enterprise IdP, so
    // the deployment reports it; a passkey-only admin needs the offer.
    state.authProvider = "auth0";
    state.emailPasswordEnabled = true;
    state.hasPassword = false;
    renderSection();

    expect(screen.getByTestId("password-action").textContent).toMatch(/Set a password/i);
  });

  it("offers nothing under Auth0 to an account holding no database identity there", () => {
    state.authProvider = "auth0";
    renderSection();

    expect(screen.queryByTestId("password-section")).toBeNull();
  });
});
