/**
 * @vitest-environment jsdom
 *
 * Sign-in methods summary integration tests.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import type { FakePersonalHostOptions } from "../../../testing.tsx";
import { SignInMethodsSummary } from "../sign-in-methods-summary.tsx";

const linkedAccountsData: { data: unknown } = { data: [] };
const identifiersData: { data: unknown } = { data: [] };
const hasPasswordData: { data: unknown; isError: boolean; error: unknown } = {
  data: { hasPassword: true },
  isError: false,
  error: null,
};

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    identity: {
      myIdentifiers: { useQuery: () => identifiersData },
    },
    user: {
      getLinkedAccounts: { useQuery: () => linkedAccountsData },
      hasPassword: { useQuery: () => hasPasswordData },
    },
  },
}));

function renderSummary(options: FakePersonalHostOptions = {}) {
  const host = fakePersonalWorkspaceHost({
    currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
    passkeys: [
      { id: "pk-1", name: "Laptop", createdAt: "2026-01-01T00:00:00.000Z", transports: "internal" },
    ],
    ...options,
  });
  renderWithPersonalWorkspaceHost(<SignInMethodsSummary />, { host });
  return host;
}

afterEach(() => {
  cleanup();
  linkedAccountsData.data = [];
  identifiersData.data = [];
  hasPasswordData.data = { hasPassword: true };
  hasPasswordData.isError = false;
  hasPasswordData.error = null;
});

describe("given an account signed in with an address, a linked account and a passkey", () => {
  describe("when the profile opens", () => {
    /** @scenario Each way in is one line */
    it("gives each one its own line, including whether a password is set", async () => {
      linkedAccountsData.data = [{ id: "acct-1", provider: "google", providerAccountId: "g-1" }];

      renderSummary();

      expect(screen.getByTestId("method-line-address")).toBeTruthy();
      await waitFor(() => expect(screen.getByTestId("method-line-passkeys")).toBeTruthy());
      expect(screen.getByTestId("method-line-linked-account")).toBeTruthy();
      expect(screen.getByTestId("method-line-password")).toBeTruthy();
    });
  });
});

describe("given the sign-in methods summary on the profile", () => {
  describe("when it renders", () => {
    /** @scenario Nothing on the summary changes anything */
    it("offers no add, rename or remove, only the way to Security", () => {
      renderSummary();

      expect(screen.queryByRole("button", { name: /add|link|rename|remove/i })).toBeNull();
      const manage = screen.getByTestId("sign-in-methods-manage");
      expect(manage.getAttribute("href")).toBe("/settings/authentication");
    });
  });
});

describe("given a deployment that offers passkeys", () => {
  describe("when the profile opens", () => {
    /** @scenario A deployment that does not offer a thing does not list it */
    it("still lists the passkey row, since every deployment offers one", async () => {
      renderSummary({
        deployment: {
          isSaas: true,
          appBaseUrl: "https://app.langwatch.ai",
          passkeysEnabled: true,
          authProvider: "email",
        },
      });

      await waitFor(() => expect(screen.getByTestId("method-line-passkeys")).toBeTruthy());
    });
  });
});

describe("given the read of whether I have a password fails", () => {
  describe("when the profile opens", () => {
    /** @scenario A read that fails says so without taking the band down */
    it("keeps my other ways in listed and says what could not be read", async () => {
      hasPasswordData.isError = true;
      hasPasswordData.error = new Error("boom");

      const host = renderSummary();

      expect(screen.getByTestId("method-line-address")).toBeTruthy();
      await waitFor(() =>
        expect(host.recording.failures).toContainEqual(
          expect.objectContaining({ fallbackTitle: "Couldn't tell whether you have a password" }),
        ),
      );
    });
  });
});

describe("given an account with a passkey but no address ever added", () => {
  describe("when the sign-in methods on the profile open", () => {
    /** @scenario An account with no identifiers still states its own address */
    it("states the account's own address, not that it has none", () => {
      renderSummary({
        currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
      });

      expect(screen.getByTestId("method-line-address").textContent).toContain("ana@acme.example");
    });
  });
});

describe("given an account with no address on it and no identifiers", () => {
  describe("when the sign-in methods on the profile open", () => {
    /** @scenario Only an account with no address anywhere is told it has none */
    it("says there is none yet", () => {
      renderSummary({
        currentUser: { id: "user-1", name: "Ana", email: null, image: null },
      });

      expect(screen.getByTestId("method-line-address").textContent).toContain("None yet");
    });
  });
});

describe("given an account holding a confirmed and an unconfirmed address", () => {
  describe("when the summary renders", () => {
    it("gives each address its own line and says whether it is confirmed", () => {
      identifiersData.data = [
        { identifierId: "a", provider: "email", value: "ana@acme.example", confirmed: true },
        { identifierId: "b", provider: "email", value: "ana@other.example", confirmed: false },
      ];

      renderSummary();

      const lines = screen.getAllByTestId("method-line-address");
      expect(lines).toHaveLength(2);
      expect(lines[0]!.textContent).toContain("Confirmed");
      expect(lines[1]!.textContent).toContain("Not confirmed yet");
    });
  });
});
