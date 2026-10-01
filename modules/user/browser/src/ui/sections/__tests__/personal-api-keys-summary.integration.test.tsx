/**
 * @vitest-environment jsdom
 *
 * Personal API keys summary integration tests.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { PersonalApiKeysSummary } from "../personal-api-keys-summary.tsx";

const listData: { data: unknown; isError: boolean; error: unknown } = {
  data: [],
  isError: false,
  error: null,
};

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {},
  api: {
    apiKey: { list: { useQuery: () => listData } },
  },
}));

function renderSummary() {
  const host = fakePersonalWorkspaceHost({
    currentUser: { id: "user-1", name: "Ana", email: "ana@acme.example", image: null },
  });
  renderWithPersonalWorkspaceHost(<PersonalApiKeysSummary />, { host });
  return host;
}

afterEach(() => {
  cleanup();
  listData.data = [];
  listData.isError = false;
  listData.error = null;
});

describe("given an admin whose colleague also holds a key", () => {
  describe("when the profile opens", () => {
    /** @scenario An administrator sees their own keys, not the organization's */
    it("shows my key and not my colleague's", () => {
      listData.data = [
        {
          id: "key-mine",
          name: "My CLI key",
          permissionMode: "full",
          userId: "user-1",
          revokedAt: null,
          lastUsedAt: null,
        },
        {
          id: "key-colleague",
          name: "Colleague's key",
          permissionMode: "full",
          userId: "user-2",
          revokedAt: null,
          lastUsedAt: null,
        },
      ];

      renderSummary();

      expect(screen.getByText("My CLI key")).toBeTruthy();
      expect(screen.queryByText("Colleague's key")).toBeNull();
    });
  });
});

describe("given one of my keys was revoked", () => {
  describe("when the profile opens", () => {
    /** @scenario A revoked key is not listed as one I hold */
    it("is not in the list", () => {
      listData.data = [
        {
          id: "key-revoked",
          name: "Old key",
          permissionMode: "full",
          userId: "user-1",
          revokedAt: new Date("2026-01-01"),
          lastUsedAt: null,
        },
      ];

      renderSummary();

      expect(screen.queryByText("Old key")).toBeNull();
      expect(screen.getByText("No key has been issued to you yet.")).toBeTruthy();
    });
  });
});

describe("given a key of mine listed", () => {
  describe("when the profile opens", () => {
    /** @scenario The keys are read here and managed on their own page */
    it("offers no way to issue or revoke, only the page that does both", () => {
      listData.data = [
        {
          id: "key-mine",
          name: "My CLI key",
          permissionMode: "full",
          userId: "user-1",
          revokedAt: null,
          lastUsedAt: null,
        },
      ];

      renderSummary();

      expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /issue/i })).toBeNull();
      const manage = screen.getByTestId("api-keys-manage");
      expect(manage.getAttribute("href")).toBe("/settings/api-keys");
    });
  });
});

describe("given the read of my keys fails", () => {
  describe("when the profile opens", () => {
    /** @scenario A key read that fails says so */
    it("is told what could not be read, with a trace to quote", () => {
      listData.isError = true;
      listData.error = new Error("boom");

      const host = renderSummary();

      expect(host.recording.failures).toContainEqual(
        expect.objectContaining({ fallbackTitle: "Couldn't read your API keys" }),
      );
    });
  });
});
