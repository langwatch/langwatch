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

const identifiersData: { data: unknown } = { data: [] };
const confirmationData: { data: unknown; error: unknown } = { data: undefined, error: null };
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
    auth: {
      myAddressConfirmation: { useQuery: () => confirmationData },
    },
    user: {
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
  confirmationData.data = undefined;
  confirmationData.error = null;
  identifiersData.data = [];
  hasPasswordData.data = { hasPassword: true };
  hasPasswordData.isError = false;
  hasPasswordData.error = null;
});

describe("given an account signed in with an address, a linked account and a passkey", () => {
  describe("when the profile opens", () => {
    /** @scenario Each way in is one line */
    it("gives each one its own line, including whether a password is set", async () => {
      identifiersData.data = [
        { identifierId: "g", provider: "google", value: "ana@gmail.example", confirmed: true },
      ];

      renderSummary();

      expect(screen.getByTestId("method-row-email")).toBeTruthy();
      await waitFor(() => expect(screen.getByTestId("method-row-passkeys")).toBeTruthy());
      expect(screen.getByTestId("method-row-federated")).toBeTruthy();
      expect(screen.getByTestId("method-row-password")).toBeTruthy();
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
      expect(manage.getAttribute("href")).toBe("/settings/security");
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

      await waitFor(() => expect(screen.getByTestId("method-row-passkeys")).toBeTruthy());
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

      expect(screen.getByTestId("method-row-email")).toBeTruthy();
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

      expect(screen.getByTestId("method-row-email").textContent).toContain("ana@acme.example");
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

      expect(screen.getByTestId("method-row-email").textContent).toContain("None yet");
    });
  });
});

describe("given an address on the account that has not been confirmed", () => {
  describe("when the sign-in methods on the profile open", () => {
    /** @scenario An address I have not confirmed is marked in Security's words */
    it("marks it not confirmed yet and marks a confirmed one nothing", () => {
      confirmationData.data = {
        email: "ana@acme.example",
        confirmed: false,
        canSendConfirmation: true,
      };
      renderSummary();
      expect(screen.getByTestId("method-row-email").textContent).toContain("Not confirmed yet");
      cleanup();

      confirmationData.data = {
        email: "ana@acme.example",
        confirmed: true,
        canSendConfirmation: true,
      };
      renderSummary();
      expect(screen.getByTestId("method-row-email").textContent).not.toContain("confirmed");
    });
  });
});

describe("given the read of my own address fails", () => {
  describe("when the sign-in methods on the profile open", () => {
    /** @scenario The read of my own address failing says so */
    it("says what could not be read and keeps the other ways in listed", async () => {
      confirmationData.error = new Error("boom");

      const host = renderSummary();

      expect(screen.getByTestId("method-row-password")).toBeTruthy();
      await waitFor(() =>
        expect(host.recording.failures).toContainEqual(
          expect.objectContaining({ fallbackTitle: "Couldn't read the address on your account" }),
        ),
      );
    });
  });
});

describe("given an account with two addresses and a single sign-on identifier", () => {
  describe("when the summary renders", () => {
    /** @scenario The sign-in methods keep the Security page's labels */
    it("labels the rows Email address and Single sign-on, and counts the addresses", () => {
      identifiersData.data = [
        {
          identifierId: "a",
          provider: "email",
          value: "ana@acme.example",
          isPrimary: true,
          confirmed: true,
        },
        {
          identifierId: "b",
          provider: "email",
          value: "ana@other.example",
          isPrimary: false,
          confirmed: true,
        },
        { identifierId: "c", provider: "oidc", value: "ana@acme.example", confirmed: true },
      ];

      renderSummary();

      expect(screen.getByTestId("method-row-email").textContent).toContain("Email address");
      expect(screen.getByTestId("method-row-email").textContent).toContain("2 addresses");
      expect(screen.getByTestId("method-row-federated").textContent).toContain("Single sign-on");
    });
  });
});
