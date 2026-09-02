/**
 * @vitest-environment jsdom
 *
 * Settings > Authentication: which sign-in methods a reader is shown, what they
 * may do to them, and what a rejected password change says.
 *
 * Moved from `platform/app/src/pages/settings/__tests__/authentication.integration.test.tsx`,
 * whose nine bound scenarios all travel. What is added is the property the
 * platform suite never stated: EVERY PASSWORD INPUT ON THIS PAGE IS A PASSWORD
 * INPUT. A credential typed into a text field is one over-the-shoulder glance
 * and one screen recording away from being somebody else's, and nothing on the
 * page said so.
 *
 * Spec: specs/settings/change-password-auth0.feature
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakePersonalWorkspaceHost,
  renderWithPersonalWorkspaceHost,
  FAKE_ORGANIZATION,
} from "../../../testing";
import AuthenticationScreen from "../authentication.screen";

const { state } = vi.hoisted(() => ({
  state: {
    authProvider: "auth0" as string | undefined,
    linkedAccounts: [] as Array<{ id: string; provider: string; providerAccountId: string }>,
    accountsLoading: false,
    hasPassword: true,
    ssoGate: void 0 as unknown,
    planType: "LAUNCH",
    changeRejectsWith: void 0 as unknown,
  },
}));

const calls = vi.hoisted(() => ({
  changePassword: vi.fn(),
  setPassword: vi.fn(),
  unlinkAccount: vi.fn(),
  invalidateLinked: vi.fn(),
  invalidateHasPassword: vi.fn(),
}));

vi.mock("../../../behavior/personal-workspace-api", () => {
  const mutation = (run: (input: unknown) => unknown) => ({
    useMutation: () => ({
      isPending: false,
      mutateAsync: async (input: unknown) => run(input),
    }),
  });
  const api = {
    useUtils: () => ({
      user: {
        getLinkedAccounts: { invalidate: calls.invalidateLinked },
        hasPassword: { invalidate: calls.invalidateHasPassword },
      },
    }),
    publicEnv: {
      useQuery: () => ({
        data: { NEXTAUTH_PROVIDER: state.authProvider, SHOW_OPS_IN_MAIN_SIDEBAR: false },
        isLoading: false,
      }),
    },
    license: {
      getSsoGateStatus: { useQuery: () => ({ data: state.ssoGate, isLoading: false }) },
    },
    limits: {
      getUsage: {
        useQuery: () => ({ data: { activePlan: { type: state.planType } }, isLoading: false }),
      },
    },
    user: {
      getLinkedAccounts: {
        useQuery: () => ({ data: state.linkedAccounts, isLoading: state.accountsLoading }),
      },
      hasPassword: {
        useQuery: () => ({ data: { hasPassword: state.hasPassword }, isLoading: false }),
      },
      changePassword: mutation((input) => {
        calls.changePassword(input);
        if (state.changeRejectsWith) throw state.changeRejectsWith;
        return { ok: true };
      }),
      setPassword: mutation((input) => {
        calls.setPassword(input);
        return { ok: true };
      }),
      unlinkAccount: mutation((input) => {
        calls.unlinkAccount(input);
        return { ok: true };
      }),
    },
  };
  return { personalWorkspaceApi: api, api };
});

beforeEach(() => {
  state.authProvider = "auth0";
  state.linkedAccounts = [{ id: "acc-1", provider: "auth0", providerAccountId: "auth0|user-123" }];
  state.accountsLoading = false;
  state.hasPassword = true;
  state.ssoGate = void 0;
  state.planType = "LAUNCH";
  state.changeRejectsWith = void 0;
  calls.changePassword.mockReset();
  calls.setPassword.mockReset();
  calls.unlinkAccount.mockReset();
  calls.invalidateLinked.mockReset();
  calls.invalidateHasPassword.mockReset();
});

afterEach(() => cleanup());

/** The deployment every case here runs on unless it says otherwise. */
function host(options: Parameters<typeof fakePersonalWorkspaceHost>[0] = {}) {
  return fakePersonalWorkspaceHost({
    deployment: {
      isSaas: true,
      appBaseUrl: "https://app.langwatch.ai",
      // The passkey section has its own suite; off here so these cases are
      // about sign-in methods only.
      passkeysEnabled: false,
    },
    permissions: ["organization:view"],
    ...options,
  });
}

function renderScreen(options: Parameters<typeof fakePersonalWorkspaceHost>[0] = {}) {
  const configured = host(options);
  renderWithPersonalWorkspaceHost(<AuthenticationScreen />, { host: configured });
  return configured;
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

describe("given an Auth0 deployment and a reader with a database identity", () => {
  describe("when the page renders", () => {
    /** @scenario Auth0 user with a database identity sees the Change Password link in their linked sign-in row */
    it("offers Change Password beside the linked identity, with no form on screen", () => {
      renderScreen();

      expect(screen.getByRole("button", { name: /Change Password/i })).toBeTruthy();
      expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
    });

    /** @scenario Auth0 user with a database identity sees the Change Password link in their linked sign-in row */
    it("names the identity by its real strategy", () => {
      renderScreen();

      expect(screen.getByText("Email/Password")).toBeTruthy();
    });
  });

  describe("when the reader opens the dialog", () => {
    /** @scenario The dialog asks for current + new password in both modes */
    it("asks for the current password, a new one and a confirmation", async () => {
      renderScreen();

      await openChangePassword();

      expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
      expect(screen.getByLabelText(/Confirm New Password/i)).toBeTruthy();
    });

    /**
     * THE PROPERTY THE PLATFORM SUITE NEVER STATED. Three inputs, every one of
     * them a credential.
     */
    /** @scenario Every password field on the page masks what is typed into it */
    it("masks all three fields", async () => {
      renderScreen();

      await openChangePassword();

      for (const label of [/Current Password/i, /^New Password$/i, /Confirm New Password/i]) {
        expect((screen.getByLabelText(label) as HTMLInputElement).type).toBe("password");
      }
    });
  });

  describe("when the change succeeds", () => {
    /** @scenario Successful change shows a toast and closes the dialog */
    it("sends both passwords, says so, and closes the dialog", async () => {
      const mounted = renderScreen();

      await openChangePassword();
      await fillAndSubmit();

      await waitFor(() => expect(calls.changePassword).toHaveBeenCalledTimes(1));
      expect(calls.changePassword.mock.calls[0]?.[0]).toEqual({
        currentPassword: "old-pw-123",
        newPassword: "new-pw-123456",
      });
      await waitFor(() =>
        expect(mounted.recording.successes).toContainEqual(
          expect.objectContaining({ title: "Password changed successfully" }),
        ),
      );
      await waitFor(() => expect(screen.queryByLabelText(/^New Password$/i)).toBeNull());
    });
  });

  describe("when the server rejects the current password", () => {
    /**
     * The whole point of this case: the reader has to be told WHICH password
     * was wrong, or they are told to wait for something that will never change.
     * The 401 carries `data.authored`, which is how the server says it wrote
     * that sentence for a customer.
     */
    /** @scenario Wrong current password keeps the dialog open and shows an error */
    it("keeps the dialog open and carries the server's own sentence", async () => {
      state.changeRejectsWith = {
        message: "Current password is incorrect",
        data: { httpStatus: 401, authored: true },
      };
      const mounted = renderScreen();

      await openChangePassword();
      await fillAndSubmit({ current: "wrong-pw" });

      await waitFor(() =>
        expect(mounted.recording.failures).toContainEqual(
          expect.objectContaining({
            fallbackTitle: "Couldn't change your password",
            description: "Current password is incorrect",
          }),
        ),
      );
      expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
    });
  });

  describe("when the server fails for a reason it did not author", () => {
    /**
     * The mirror of the case above. A 500's message names Auth0 scopes and
     * environment variables — an operator's detail, not a customer's — so it
     * degrades to the action that failed plus the generic line. Do not restore
     * a message assertion here; relaying it was the #5984 bug.
     */
    /** @scenario Server error keeps the dialog open and shows the error */
    it("keeps the dialog open and says nothing the server wrote", async () => {
      state.changeRejectsWith = new Error("Auth0 is not authorized to update users.");
      const mounted = renderScreen();

      await openChangePassword();
      await fillAndSubmit();

      await waitFor(() => expect(mounted.recording.failures).toHaveLength(1));
      expect(mounted.recording.failures[0]).toEqual(
        expect.objectContaining({
          fallbackTitle: "Couldn't change your password",
          description: void 0,
        }),
      );
      expect(screen.getByLabelText(/^New Password$/i)).toBeTruthy();
    });
  });

  describe("when the reader cancels", () => {
    /** @scenario Cancel button closes the dialog without submitting */
    it("closes without sending anything", async () => {
      renderScreen();

      await openChangePassword();
      await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));

      await waitFor(() => expect(screen.queryByLabelText(/^New Password$/i)).toBeNull());
      expect(calls.changePassword).not.toHaveBeenCalled();
    });
  });

  describe("when the dialog is reopened", () => {
    /** @scenario Reopening the dialog clears any previously-typed values */
    it("clears what was typed the first time", async () => {
      renderScreen();

      await openChangePassword();
      await userEvent.type(screen.getByLabelText(/^New Password$/i), "leftover-value");
      await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));
      await waitFor(() => expect(screen.queryByLabelText(/^New Password$/i)).toBeNull());

      await openChangePassword();

      expect((screen.getByLabelText(/^New Password$/i) as HTMLInputElement).value).toBe("");
    });
  });
});

describe("given an Auth0 deployment and a reader with a social identity only", () => {
  describe("when the page renders", () => {
    /** @scenario Auth0 social-only user (Google via Auth0) does not see Change Password */
    it("offers no Change Password control, because there is no password to change", () => {
      state.linkedAccounts = [
        { id: "acc-google", provider: "auth0", providerAccountId: "google-oauth2|abc" },
      ];
      renderScreen();

      expect(screen.queryByRole("button", { name: /Change Password/i })).toBeNull();
      expect(screen.getByText("Google")).toBeTruthy();
    });
  });
});

describe("given an email deployment", () => {
  describe("when the reader has a password", () => {
    /** @scenario Email/credential user sees a dedicated Change Password section with just a button */
    it("shows one button and no form", () => {
      state.authProvider = "email";
      renderScreen();

      expect(screen.getByTestId("password-action")).toHaveTextContent("Change Password");
      expect(screen.queryByLabelText(/^New Password$/i)).toBeNull();
    });
  });

  describe("when the reader has none", () => {
    /**
     * A passkey sign-up leaves an account with no password, and the offer has
     * to change: "Change Password" over an account that has none is a control
     * whose submit can only fail.
     */
    /** @scenario An account with no password can set a first one */
    it("offers to set a first one instead", async () => {
      state.authProvider = "email";
      state.hasPassword = false;
      renderScreen();

      expect(screen.getByTestId("password-action")).toHaveTextContent("Set a password");

      await userEvent.click(screen.getByTestId("password-action"));

      // No current password to ask for, so the field is not shown at all.
      await waitFor(() => expect(screen.getByLabelText(/^Password$/i)).toBeTruthy());
      expect(screen.queryByLabelText(/Current Password/i)).toBeNull();
    });

    /** @scenario An account with no password can set a first one */
    it("asks the offer again after one is set, so the button does not linger", async () => {
      state.authProvider = "email";
      state.hasPassword = false;
      renderScreen();

      await userEvent.click(screen.getByTestId("password-action"));
      await waitFor(() => expect(screen.getByLabelText(/^Password$/i)).toBeTruthy());
      await userEvent.type(screen.getByLabelText(/^Password$/i), "new-pw-123456");
      await userEvent.type(screen.getByLabelText(/Confirm password/i), "new-pw-123456");
      await userEvent.click(screen.getByRole("button", { name: /^Set password$/i }));

      await waitFor(() =>
        expect(calls.setPassword).toHaveBeenCalledWith({
          password: "new-pw-123456",
        }),
      );
      expect(calls.invalidateHasPassword).toHaveBeenCalled();
    });
  });
});

describe("given a deployment on an identity provider the product cannot reach", () => {
  describe("when the page renders", () => {
    it("offers no password control at all", () => {
      state.authProvider = "google";
      state.linkedAccounts = [
        { id: "acc-google", provider: "google", providerAccountId: "google-id" },
      ];
      renderScreen();

      expect(screen.queryByRole("button", { name: /Change Password/i })).toBeNull();
    });
  });
});

describe("given an organization pinned to a single sign-on provider", () => {
  describe("when the page renders", () => {
    /**
     * A second way in would route around the provider the organization chose,
     * so neither linking nor removing is offered.
     */
    /** @scenario An organization on single sign-on links and removes nothing */
    it("says why, and offers neither linking nor removing", () => {
      state.linkedAccounts = [
        { id: "acc-1", provider: "auth0", providerAccountId: "okta|a" },
        { id: "acc-2", provider: "auth0", providerAccountId: "github|b" },
      ];
      renderScreen({
        organization: { ...FAKE_ORGANIZATION, ssoProvider: "okta" },
      });

      expect(screen.getByText(/company's SSO provider/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Link another sign-in method/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Remove sign-in method/i })).toBeNull();
    });
  });
});

describe("given an organization with no single sign-on and two linked methods", () => {
  describe("when the reader removes one", () => {
    /** @scenario Removing a linked sign-in method re-reads the list */
    it("sends the account id and re-reads the list", async () => {
      state.linkedAccounts = [
        { id: "acc-1", provider: "auth0", providerAccountId: "okta|a" },
        { id: "acc-2", provider: "auth0", providerAccountId: "github|b" },
      ];
      const mounted = renderScreen();

      const removals = screen.getAllByRole("button", { name: "Remove sign-in method" });
      await userEvent.click(removals[0]!);

      await waitFor(() => expect(calls.unlinkAccount).toHaveBeenCalledWith({ accountId: "acc-1" }));
      expect(calls.invalidateLinked).toHaveBeenCalled();
      await waitFor(() =>
        expect(mounted.recording.successes).toContainEqual(
          expect.objectContaining({ title: "Sign-in method removed" }),
        ),
      );
    });
  });

  describe("when only one method is linked", () => {
    /** @scenario The only linked sign-in method offers no way to remove it */
    it("offers no way to remove it", () => {
      renderScreen();

      expect(screen.queryByRole("button", { name: "Remove sign-in method" })).toBeNull();
    });
  });

  describe("when the reader links another", () => {
    /** @scenario Linking an additional sign-in method goes through the account-linking route */
    it("asks the application to run the exchange for the configured provider", async () => {
      state.linkedAccounts = [{ id: "acc-1", provider: "auth0", providerAccountId: "okta|a" }];
      const mounted = renderScreen();

      await userEvent.click(screen.getByRole("button", { name: /Link another sign-in method/i }));

      await waitFor(() => expect(mounted.recording.linkedProviders).toEqual(["auth0"]));
    });
  });
});

describe("given a deployment that reports no sign-in mode at all", () => {
  describe("when the page renders", () => {
    it("says the surface is unavailable rather than offering broken controls", () => {
      state.authProvider = void 0;
      renderScreen();

      expect(screen.getByText(/Sign-in management is unavailable/i)).toBeTruthy();
    });
  });
});

describe("given a self-hosted deployment", () => {
  describe("when it holds no Enterprise license", () => {
    /** @scenario An unlicensed deployment sees what a license would unlock */
    it("lists what a license would unlock rather than hiding it", () => {
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
        },
      });

      const section = screen.getByTestId("enterprise-capabilities");
      expect(within(section).getByText("Single sign-on")).toBeTruthy();
      expect(within(section).getByText("SCIM provisioning")).toBeTruthy();
      expect(within(section).getByText("Audit logs")).toBeTruthy();
      expect(within(section).getAllByText("Enterprise license")).toHaveLength(3);
    });

    /** @scenario An unlicensed deployment is told how to obtain a license */
    it("offers the way to activate one", () => {
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
        },
      });

      expect(screen.getByRole("link", { name: /Activate a license/i })).toBeTruthy();
    });
  });

  describe("when it holds one", () => {
    /** @scenario A licensed deployment sees the capabilities as available */
    it("marks the capabilities as available and stops selling", () => {
      state.planType = "ENTERPRISE";
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
        },
      });

      const section = screen.getByTestId("enterprise-capabilities");
      expect(within(section).getAllByText("Available")).toHaveLength(3);
      expect(screen.queryByRole("link", { name: /Activate a license/i })).toBeNull();
    });
  });

  describe("when single sign-on is configured but unlicensed", () => {
    /** @scenario An operator whose single sign-on is configured but unlicensed is told so */
    it("names the license as the cause", () => {
      state.ssoGate = { configuredProvider: "okta", licensed: false, mounted: false };
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
        },
      });

      expect(screen.getByTestId("sso-unlicensed-notice")).toBeTruthy();
      expect(screen.queryByTestId("sso-not-started-notice")).toBeNull();
    });
  });

  describe("when single sign-on is licensed but never started", () => {
    /** @scenario An operator whose identity provider could not be started is told so */
    it("names the provider as the cause instead", () => {
      state.ssoGate = { configuredProvider: "okta", licensed: true, mounted: false };
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
        },
      });

      expect(screen.getByTestId("sso-not-started-notice")).toBeTruthy();
    });
  });

  describe("when single sign-on is licensed and running", () => {
    /** @scenario An operator whose identity provider could not be started is told so */
    it("says nothing about it", () => {
      state.ssoGate = { configuredProvider: "okta", licensed: true, mounted: true };
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
        },
      });

      expect(screen.queryByTestId("sso-unlicensed-notice")).toBeNull();
      expect(screen.queryByTestId("sso-not-started-notice")).toBeNull();
    });
  });
});

describe("given LangWatch Cloud", () => {
  describe("when the page renders", () => {
    /**
     * There these are provisioned as part of the plan, so the section would be
     * noise on a page about sign-in methods — and the separator belongs to the
     * section for that reason, so Cloud does not get a divider with nothing
     * under it.
     */
    /** @scenario Cloud hides the self-hosted licensing section */
    it("hides the self-hosted licensing section entirely", () => {
      renderScreen();

      expect(screen.queryByTestId("enterprise-capabilities")).toBeNull();
    });
  });
});
