/**
 * @vitest-environment jsdom
 *
 * Email address and linked accounts. Scoped with `within`, see the handoff.
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { providerDisplayName } from "../../../model/sign-in-methods.ts";
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
    identifiers: [] as Record<string, unknown>[],
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
      user: {
        getLinkedAccounts: { invalidate: calls.invalidateLinked },
        hasPassword: { invalidate: vi.fn() },
      },
      identity: { myIdentifiers: { invalidate: vi.fn() } },
    }),
    identity: {
      myIdentifiers: {
        useQuery: () => ({ data: state.identifiers, isPending: false, error: null }),
      },
      myMethodsLastUsed: { useQuery: () => ({ data: undefined }) },
      addEmailIdentifier: mutation(() => ({ identifierId: "id-new" })),
      resendIdentifierConfirmation: mutation(() => ({ sent: true })),
      removeIdentifier: mutation(() => ({ removed: true })),
      completeVerification: mutation(() => ({ verified: true })),
    },
    auth: {
      myAddressConfirmation: {
        useQuery: () => ({
          data: { email: "carol@acme.example", confirmed: true, canSendConfirmation: true },
          isPending: false,
        }),
      },
      sendMyAddressConfirmation: mutation(() => ({ sent: true, identifierId: "id-own" })),
    },
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
  state.identifiers = [];
  calls.unlinkAccount.mockReset();
  calls.invalidateLinked.mockReset();
});

afterEach(() => cleanup());

/** What the detach guard says about one linked account, as the route would answer it. */
function verdict(overrides: Record<string, unknown> & { accountId: string }) {
  return {
    identifierId: `id-${overrides.accountId}`,
    provider: "oidc",
    value: `${overrides.accountId}@acme.example`,
    isPrimary: false,
    confirmed: true,
    resendable: false,
    removable: true,
    refusalCode: null,
    demotesFirst: false,
    ...overrides,
  };
}

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
    /** @scenario "Email addresses and linked accounts sit under one heading" */
    it("lists the address and the linked providers under one heading, with one row of offers", () => {
      const { scope } = renderSection();

      const section = scope.getByTestId("email-and-linked-accounts-section");
      expect(within(section).getByText("carol@acme.example")).toBeTruthy();
      expect(
        within(section).getByText(providerDisplayName("auth0", "auth0|user-123")),
      ).toBeTruthy();
      const offers = within(scope.getByTestId("identifier-action-row"));
      expect(offers.getByTestId("add-address")).toBeTruthy();
      expect(offers.getByRole("button", { name: /Connect single sign-on/i })).toBeTruthy();
    });
  });
});

describe("given a deployment that offers several federated providers", () => {
  describe("when the page renders", () => {
    /** @scenario "Each provider that can still be linked has its own connect button" */
    it("offers one named button per provider not yet linked", () => {
      state.linkedAccounts = [
        { id: "acc-1", provider: "auth0", providerAccountId: "auth0|user-123" },
        { id: "acc-2", provider: "google", providerAccountId: "g-1" },
      ];
      const { scope } = renderSection({
        deployment: {
          isSaas: true,
          appBaseUrl: "https://app.langwatch.ai",
          passkeysEnabled: false,
          authProvider: "auth0",
          federatedProviders: ["github", "google", "auth0"],
        },
      });

      expect(scope.getByRole("button", { name: "Connect GitHub" })).toBeTruthy();
      expect(scope.getByRole("button", { name: "Connect single sign-on" })).toBeTruthy();
      expect(scope.queryByRole("button", { name: "Connect Google" })).toBeNull();
    });
  });
});

describe("given a deployment that reports no identity provider", () => {
  describe("when the page renders", () => {
    it("still manages the addresses and offers no provider link", () => {
      state.authProvider = void 0;
      const { scope } = renderSection();

      expect(scope.getByTestId("add-address")).toBeTruthy();
      expect(scope.queryByRole("button", { name: /Connect single sign-on/i })).toBeNull();
    });
  });
});

describe("given an organization pinned to a single sign-on provider", () => {
  describe("when the page renders", () => {
    it("says why nothing more can be linked, and offers no connect button", () => {
      state.linkedAccounts = [{ id: "acc-1", provider: "auth0", providerAccountId: "okta|a" }];
      const { scope } = renderSection({
        organization: { ...FAKE_ORGANIZATION, ssoProvider: "okta" },
      });

      expect(scope.getByText(/company's SSO provider/i)).toBeTruthy();
      expect(scope.queryByRole("button", { name: /Connect single sign-on/i })).toBeNull();
    });
  });

  describe("when the reader asks to unlink the single sign-on method", () => {
    /** @scenario "A member of an organization that enforces single sign-on is told it comes back" */
    it("says signing in that way links it again, and allows the unlink", async () => {
      state.linkedAccounts = [{ id: "acc-1", provider: "auth0", providerAccountId: "okta|a" }];
      state.identifiers = [verdict({ accountId: "acc-1" })];
      const { scope } = renderSection({
        organization: { ...FAKE_ORGANIZATION, ssoProvider: "okta" },
      });

      await userEvent.click(scope.getByTestId("unlink-method"));

      const notice = await screen.findByTestId("unlink-relinks-on-sso");
      expect(notice.textContent).toMatch(/linked again/i);
      expect(screen.getByTestId("confirm-unlink-method")).toHaveProperty("disabled", false);
    });
  });
});

describe("given an organization with no single sign-on and two linked methods", () => {
  describe("when the reader asks to unlink one", () => {
    /** @scenario "Unlinking a single sign-on method asks first and says what stays" */
    /** @scenario "Removing a linked sign-in method re-reads the list" */
    it("names the ways in that stay and unlinks nothing until confirmed", async () => {
      state.linkedAccounts = [
        { id: "acc-1", provider: "auth0", providerAccountId: "okta|a" },
        { id: "acc-2", provider: "auth0", providerAccountId: "github|b" },
      ];
      state.identifiers = [
        verdict({ accountId: "acc-1", value: "sam@acme.example" }),
        verdict({ accountId: "acc-2", value: "sam@gmail.example" }),
      ];
      const { scope, host } = renderSection();

      await userEvent.click(scope.getAllByTestId("unlink-method")[0]!);

      const dialog = await screen.findByTestId("unlink-method-dialog");
      expect(dialog.textContent).toContain("sam@gmail.example");
      expect(calls.unlinkAccount).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId("confirm-unlink-method"));

      await waitFor(() => expect(calls.unlinkAccount).toHaveBeenCalledWith({ accountId: "acc-1" }));
      expect(calls.invalidateLinked).toHaveBeenCalled();
      await waitFor(() =>
        expect(host.recording.successes).toContainEqual(
          expect.objectContaining({ title: "Sign-in method removed" }),
        ),
      );
    });

    /** @scenario "Unlinking a primary single sign-on method demotes it first" */
    it("says another way in becomes primary before it goes", async () => {
      state.linkedAccounts = [
        { id: "acc-1", provider: "auth0", providerAccountId: "okta|a" },
        { id: "acc-2", provider: "auth0", providerAccountId: "github|b" },
      ];
      state.identifiers = [
        verdict({ accountId: "acc-1", isPrimary: true, demotesFirst: true }),
        verdict({ accountId: "acc-2" }),
      ];
      const { scope } = renderSection();

      await userEvent.click(scope.getAllByTestId("unlink-method")[0]!);

      const dialog = await screen.findByTestId("unlink-method-dialog");
      expect(dialog.textContent).toMatch(/becomes primary first/i);
    });
  });

  describe("when the guard would refuse the only linked method", () => {
    /** @scenario "The only linked sign-in method stands its remove control down" */
    it("stands the control down before the click", () => {
      state.identifiers = [
        verdict({
          accountId: "acc-1",
          removable: false,
          refusalCode: "identity_detach_strands_user",
        }),
      ];
      const { scope } = renderSection();

      expect(scope.getByTestId("unlink-method")).toHaveProperty("disabled", true);
      expect(scope.queryByTestId("unlink-method-dialog")).toBeNull();
    });
  });

  describe("when the reader links another", () => {
    /** @scenario "Linking an additional sign-in method goes through the account-linking route" */
    it("asks the application to run the exchange for the configured provider", async () => {
      state.linkedAccounts = [{ id: "acc-1", provider: "auth0", providerAccountId: "okta|a" }];
      const { scope, host } = renderSection();

      await userEvent.click(scope.getByRole("button", { name: /Connect single sign-on/i }));

      await waitFor(() => expect(host.recording.linkedProviders).toEqual(["auth0"]));
    });
  });
});
