/** @vitest-environment jsdom */
/**
 * The testing license token list and the service token drawer on the Licenses page.
 * Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import { TestingLicenseTokensSection } from "../ui/sections/testing-license-tokens-section.tsx";

const serviceToken = {
  id: "tlt_service",
  kind: "service",
  name: "CI on main",
  ownerUserId: "user_maker",
  expiresAt: "2027-01-01T00:00:00.000Z",
  revokedAt: null,
  revokedById: null,
  lastUsedAt: "2026-10-10T09:30:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  status: "active",
};
const personalToken = {
  ...serviceToken,
  id: "tlt_personal",
  kind: "personal",
  name: null,
  ownerUserId: "user_dev",
  lastUsedAt: null,
};

const calls = vi.hoisted(() => ({
  revoke: vi.fn(),
  create: vi.fn(),
  created: { token: "lwtl_shown_once" },
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn().mockResolvedValue(undefined) } }),
    licenseRegistry: {
      testingLicenseTokens: {
        useQuery: () => ({
          data: { tokens: [serviceToken, personalToken], total: 2 },
          error: null,
          isLoading: false,
        }),
      },
      revokeTestingLicenseToken: {
        useMutation: () => ({ mutate: calls.revoke, isPending: false }),
      },
      createTestingLicenseServiceToken: {
        useMutation: () => ({
          mutate: (input: unknown, opts?: { onSuccess?: (result: unknown) => void }) => {
            calls.create(input);
            opts?.onSuccess?.(calls.created);
          },
          isPending: false,
        }),
      },
    },
  },
}));

describe("TestingLicenseTokensSection", () => {
  beforeEach(() => {
    calls.revoke.mockClear();
    calls.create.mockClear();
  });

  describe("given personal and service tokens exist", () => {
    describe("when an ops manager opens the service token list", () => {
      /** @scenario "Ops managers see every service token and when it was last used" */
      it("shows each token with its name, owner, expiry and last use", () => {
        renderWithOpsHost(<TestingLicenseTokensSection />);

        expect(screen.getByText("CI on main")).toBeTruthy();
        expect(screen.getByText("Personal token")).toBeTruthy();
        expect(screen.getByText("never used")).toBeTruthy();
        expect(screen.getAllByText("active")).toHaveLength(2);
        expect(screen.getAllByText(/2027/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
      });
    });

    describe("when the ops manager revokes a token and confirms", () => {
      /** @scenario "Ops managers see every service token and when it was last used" */
      it("revokes that token only after the confirmation", async () => {
        renderWithOpsHost(<TestingLicenseTokensSection />);

        fireEvent.click(screen.getByRole("button", { name: "Revoke CI on main" }));
        expect(calls.revoke).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole("button", { name: "Revoke token" }));

        await waitFor(() => expect(calls.revoke).toHaveBeenCalledTimes(1));
        expect(calls.revoke.mock.calls[0]?.[0]).toEqual({ id: "tlt_service" });
      });
    });
  });

  describe("given an ops manager creating a service token", () => {
    async function openDrawer() {
      renderWithOpsHost(<TestingLicenseTokensSection />);
      fireEvent.click(screen.getByRole("button", { name: "New service token" }));
      return screen.findByRole("textbox", { name: "Name" });
    }

    describe("when the expiry is past the maximum", () => {
      /** @scenario "An ops manager creates a service token for CI" */
      it("says so and creates nothing", async () => {
        const name = await openDrawer();
        fireEvent.change(name, { target: { value: "CI" } });
        fireEvent.change(screen.getByLabelText("Expires in, in days"), {
          target: { value: "400" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create token" }));

        expect(await screen.findByText("Enter a whole number of days from 1 to 365.")).toBeTruthy();
        expect(calls.create).not.toHaveBeenCalled();
      });
    });

    describe("when the manager creates it with the default expiry", () => {
      /** @scenario "An ops manager creates a service token for CI" */
      it("sends 90 days and shows the token once", async () => {
        const name = await openDrawer();
        fireEvent.change(name, { target: { value: "  CI on main  " } });
        fireEvent.click(screen.getByRole("button", { name: "Create token" }));

        await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
        expect(calls.create.mock.calls[0]?.[0]).toEqual({ name: "CI on main", expiresInDays: 90 });
        const shown = await screen.findByRole("textbox", { name: "Service token" });
        expect(shown).toHaveValue("lwtl_shown_once");
        expect(screen.getByText(/cannot be shown again/)).toBeTruthy();
      });
    });
  });
});
