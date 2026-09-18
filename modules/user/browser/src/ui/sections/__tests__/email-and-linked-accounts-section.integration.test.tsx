/**
 * @vitest-environment jsdom
 *
 * Email address and linked accounts. Scoped with `within`, see the handoff.
 */

import { cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakePersonalWorkspaceHost,
  renderWithPersonalWorkspaceHost,
  FAKE_ORGANIZATION,
} from "../../../testing.tsx";
import { EmailAndLinkedAccountsSection } from "../email-and-linked-accounts-section.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    authProvider: "auth0" as string | undefined,
    linkedAccounts: [] as { id: string; provider: string; providerAccountId: string }[],
    accountsLoading: false,
  },
}));

const calls = vi.hoisted(() => ({
  unlinkAccount: vi.fn(),
  invalidateLinked: vi.fn(),
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
      user: { getLinkedAccounts: { invalidate: calls.invalidateLinked } },
    }),
    user: {
      getLinkedAccounts: {
        useQuery: () => ({ data: state.linkedAccounts, isLoading: state.accountsLoading }),
      },
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
  calls.unlinkAccount.mockReset();
  calls.invalidateLinked.mockReset();
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
      ...options.deployment,
    },
  });
  const view = renderWithPersonalWorkspaceHost(<EmailAndLinkedAccountsSection />, { host });
  return { host, scope: within(view.container) };
}

describe("given the reader's own account", () => {
  describe("when the page renders", () => {
    // NOT a binding of "Email addresses and linked accounts sit under one
    // heading": that scenario also needs an "add an email address" offer,
    // which no procedure exists for yet (see the handoff).
    it("shows the account's address and the linked providers under one heading", () => {
      const { scope } = renderSection();

      expect(scope.getByTestId("email-and-linked-accounts-section")).toBeTruthy();
      expect(scope.getByText("carol@acme.example")).toBeTruthy();
    });
  });
});

describe("given a deployment that reports no sign-in mode at all", () => {
  describe("when the page renders", () => {
    it("says the surface is unavailable rather than offering broken controls", () => {
      state.authProvider = void 0;
      const { scope } = renderSection();

      expect(scope.getByText(/Sign-in management is unavailable/i)).toBeTruthy();
    });
  });
});

describe("given an organization pinned to a single sign-on provider", () => {
  describe("when the page renders", () => {
    /** @scenario "An organization on single sign-on links and removes nothing" */
    it("says why, and offers neither linking nor removing", () => {
      state.linkedAccounts = [
        { id: "acc-1", provider: "auth0", providerAccountId: "okta|a" },
        { id: "acc-2", provider: "auth0", providerAccountId: "github|b" },
      ];
      const { scope } = renderSection({
        organization: { ...FAKE_ORGANIZATION, ssoProvider: "okta" },
      });

      expect(scope.getByText(/company's SSO provider/i)).toBeTruthy();
      expect(scope.queryByRole("button", { name: /Link another sign-in method/i })).toBeNull();
      expect(scope.queryByRole("button", { name: /Remove sign-in method/i })).toBeNull();
    });
  });
});

describe("given an organization with no single sign-on and two linked methods", () => {
  describe("when the reader removes one", () => {
    /** @scenario "Removing a linked sign-in method re-reads the list" */
    it("sends the account id and re-reads the list", async () => {
      state.linkedAccounts = [
        { id: "acc-1", provider: "auth0", providerAccountId: "okta|a" },
        { id: "acc-2", provider: "auth0", providerAccountId: "github|b" },
      ];
      const { scope, host } = renderSection();

      const removals = scope.getAllByRole("button", { name: "Remove sign-in method" });
      await userEvent.click(removals[0]!);

      await waitFor(() => expect(calls.unlinkAccount).toHaveBeenCalledWith({ accountId: "acc-1" }));
      expect(calls.invalidateLinked).toHaveBeenCalled();
      await waitFor(() =>
        expect(host.recording.successes).toContainEqual(
          expect.objectContaining({ title: "Sign-in method removed" }),
        ),
      );
    });
  });

  describe("when only one method is linked", () => {
    /** @scenario "The only linked sign-in method offers no way to remove it" */
    it("offers no way to remove it", () => {
      const { scope } = renderSection();

      expect(scope.queryByRole("button", { name: "Remove sign-in method" })).toBeNull();
    });
  });

  describe("when the reader links another", () => {
    /** @scenario "Linking an additional sign-in method goes through the account-linking route" */
    it("asks the application to run the exchange for the configured provider", async () => {
      state.linkedAccounts = [{ id: "acc-1", provider: "auth0", providerAccountId: "okta|a" }];
      const { scope, host } = renderSection();

      await userEvent.click(scope.getByRole("button", { name: /Link another sign-in method/i }));

      await waitFor(() => expect(host.recording.linkedProviders).toEqual(["auth0"]));
    });
  });
});
