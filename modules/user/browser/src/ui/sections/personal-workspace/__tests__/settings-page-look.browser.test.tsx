/**
 * Real-Chromium look of the Profile and Security pages: the 820px column, the hairline above each
 * band and the bordered rows are measured layout and computed style, which jsdom reports as zero.
 * Spec: specs/settings/profile.feature, specs/identity/authentication-settings.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { PersonalWorkspaceHostProvider } from "../../../../model/personal-workspace-host.ts";
import { fakePersonalWorkspaceHost } from "../../../../testing.tsx";

vi.mock("../../../../behavior/personal-workspace-api.ts", () => {
  const mutation = () => ({
    useMutation: () => ({ isPending: false, mutate: () => {}, mutateAsync: async () => ({}) }),
  });
  const session = {
    sessionId: "session-1",
    identifierId: "identifier-1",
    method: "Email and password",
    secondFactorProven: false,
    ipAddress: "203.0.113.4",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    signedInAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: "2026-01-02T00:00:00.000Z",
    expiresAt: "2026-02-01T00:00:00.000Z",
    current: true,
  };
  const api = {
    useUtils: () => ({
      auth: { browserSessions: { invalidate: () => Promise.resolve() } },
      user: { getLinkedAccounts: { invalidate: vi.fn() }, hasPassword: { invalidate: vi.fn() } },
    }),
    routingPolicy: { personalContext: { useQuery: () => ({ error: null, isFetching: false }) } },
    identity: {
      myIdentifiers: { useQuery: () => ({ data: [], isPending: false, error: null }) },
      myMethodsLastUsed: { useQuery: () => ({ data: void 0 }) },
      addEmailIdentifier: mutation(),
      resendIdentifierConfirmation: mutation(),
      removeIdentifier: mutation(),
      completeVerification: mutation(),
    },
    auth: {
      changePassword: mutation(),
      setPassword: mutation(),
      endBrowserSession: mutation(),
      sendMyAddressConfirmation: mutation(),
      browserSessions: { useQuery: () => ({ data: [session], isLoading: false }) },
      myAddressConfirmation: {
        useQuery: () => ({
          data: { email: "sam@acme.test", confirmed: true, canSendConfirmation: true },
          isPending: false,
        }),
      },
    },
    license: { getSsoGateStatus: { useQuery: () => ({ data: void 0, isLoading: false }) } },
    plan: { getActivePlan: { useQuery: () => ({ data: { type: "LAUNCH" }, isLoading: false }) } },
    user: {
      getLinkedAccounts: {
        useQuery: () => ({
          data: [{ id: "acc-1", provider: "auth0", providerAccountId: "auth0|user-123" }],
          isLoading: false,
        }),
      },
      hasPassword: { useQuery: () => ({ data: { hasPassword: true }, isLoading: false }) },
      unlinkAccount: mutation(),
      updateName: mutation(),
      setAvatar: mutation(),
      removeAvatar: mutation(),
    },
  };
  return { personalWorkspaceApi: api, api };
});

vi.mock("@langwatch/api-key-client", () => ({
  apiKeyClient: {
    apiKey: {
      list: {
        useQuery: () => ({
          data: [
            {
              id: "key-1",
              name: "My CLI key",
              permissionMode: "full",
              userId: "user-1",
              revokedAt: null,
              lastUsedAt: null,
            },
          ],
        }),
      },
    },
  },
}));

vi.mock("@langwatch/api/web", () => ({
  createModuleApi: () => ({
    useUtils: () => ({ twoStepVerification: { account: { invalidate: vi.fn() } } }),
    twoStepVerification: {
      account: {
        useQuery: () => ({
          data: { offered: true, enabled: false, holdsPasskey: false, requiringOrganizations: [] },
          isPending: false,
        }),
      },
      disable: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
  }),
}));

vi.mock("../../../../behavior/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) => image ?? null,
}));

const { default: ProfileScreen } = await import("../profile.screen.tsx");
const { default: SecurityScreen } = await import("../security.screen.tsx");

function mount(screen: "profile" | "security") {
  const host = fakePersonalWorkspaceHost({
    currentUser: { id: "user-1", name: "Sam", email: "sam@acme.test", image: null },
    permissions: ["organization:view"],
    deployment: {
      isSaas: true,
      appBaseUrl: "https://app.langwatch.ai",
      passkeysEnabled: false,
      authProvider: "auth0",
    },
  });
  return renderWithDesignSystem(
    <PersonalWorkspaceHostProvider value={host}>
      {screen === "profile" ? <ProfileScreen /> : <SecurityScreen />}
    </PersonalWorkspaceHostProvider>,
  ).container;
}

/** The measured column, its divided bands and the rows inside them. */
function look(container: HTMLElement, rowIds: string[]) {
  const bands = [...container.querySelectorAll("section")];
  const column = bands[0]!.parentElement!;
  const rows = [
    ...container.querySelectorAll<HTMLElement>(
      rowIds.map((id) => `[data-testid="${id}"]`).join(","),
    ),
  ];
  return { column, bands, rows };
}

const hasBorder = (element: Element, side: "Top" | "Right" | "Bottom" | "Left" | "All") => {
  const style = getComputedStyle(element);
  const sides = side === "All" ? (["Top", "Right", "Bottom", "Left"] as const) : [side];
  return sides.every(
    (s) =>
      parseFloat(style[`border${s}Width`]) > 0 &&
      style[`border${s}Style`] === "solid" &&
      style[`border${s}Color`] !== "rgba(0, 0, 0, 0)",
  );
};

beforeEach(async () => {
  await page.viewport(1400, 900);
});

afterEach(() => cleanup());

describe("given a wide window", () => {
  describe("when the profile page renders", () => {
    /** @scenario The profile is a narrow column of divided bands with bordered rows */
    it("is an 820px column of divided bands whose rows are bordered", async () => {
      const container = mount("profile");
      await waitFor(() => expect(screen.getByText("My CLI key")).toBeVisible());
      const { column, bands, rows } = look(container, [
        "browser-session-row",
        "personal-api-key-row",
      ]);

      expect(getComputedStyle(column).maxWidth).toBe("820px");
      expect(column.getBoundingClientRect().width).toBeLessThanOrEqual(820);
      expect(column.getBoundingClientRect().width).toBeGreaterThan(600);
      expect(bands.length).toBeGreaterThanOrEqual(4);
      for (const band of bands) expect(hasBorder(band, "Top")).toBe(true);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(hasBorder(row, "All")).toBe(true);
    });
  });

  describe("when the security page renders", () => {
    /** @scenario The page is a narrow column of divided sections with bordered rows */
    it("is an 820px column of divided sections whose rows are bordered", async () => {
      const container = mount("security");
      await waitFor(() => expect(screen.getByText("Security", { exact: true })).toBeVisible());
      const { column, bands, rows } = look(container, ["linked-account-row"]);

      expect(getComputedStyle(column).maxWidth).toBe("820px");
      expect(column.getBoundingClientRect().width).toBeLessThanOrEqual(820);
      expect(column.getBoundingClientRect().width).toBeGreaterThan(600);
      expect(bands.length).toBeGreaterThanOrEqual(3);
      for (const band of bands) expect(hasBorder(band, "Top")).toBe(true);
      expect(rows).toHaveLength(1);
      for (const row of rows) expect(hasBorder(row, "All")).toBe(true);
    });
  });
});
