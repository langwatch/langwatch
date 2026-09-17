/**
 * @vitest-environment jsdom
 *
 * Security screen: composition and the self-hosted licensing band.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakePersonalWorkspaceHost,
  renderWithPersonalWorkspaceHost,
} from "../../../../testing.tsx";
import SecurityScreen from "../security.screen.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    linkedAccounts: [] as { id: string; provider: string; providerAccountId: string }[],
    hasPassword: true,
    ssoGate: void 0 as unknown,
    planType: "LAUNCH",
  },
}));

vi.mock("../../../../behavior/personal-workspace-api.ts", () => {
  const mutation = () => ({
    useMutation: () => ({ isPending: false, mutateAsync: async () => ({ ok: true }) }),
  });
  const api = {
    useUtils: () => ({
      user: { getLinkedAccounts: { invalidate: vi.fn() }, hasPassword: { invalidate: vi.fn() } },
    }),
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
        useQuery: () => ({ data: state.linkedAccounts, isLoading: false }),
      },
      hasPassword: {
        useQuery: () => ({ data: { hasPassword: state.hasPassword }, isLoading: false }),
      },
      changePassword: mutation(),
      setPassword: mutation(),
      unlinkAccount: mutation(),
    },
  };
  return { personalWorkspaceApi: api, api };
});

beforeEach(() => {
  state.linkedAccounts = [{ id: "acc-1", provider: "auth0", providerAccountId: "auth0|user-123" }];
  state.hasPassword = true;
  state.ssoGate = void 0;
  state.planType = "LAUNCH";
});

afterEach(() => cleanup());

function renderScreen(options: Parameters<typeof fakePersonalWorkspaceHost>[0] = {}) {
  const host = fakePersonalWorkspaceHost({
    permissions: ["organization:view"],
    ...options,
    deployment: {
      isSaas: true,
      appBaseUrl: "https://app.langwatch.ai",
      passkeysEnabled: false,
      authProvider: "auth0",
      ...options.deployment,
    },
  });
  renderWithPersonalWorkspaceHost(<SecurityScreen />, { host });
  return host;
}

describe("given a signed-in reader", () => {
  describe("when the page renders", () => {
    /** @scenario "The page is four sections, one per subject" */
    it("runs from what the reader is known by, through the two proofs, to the password", () => {
      renderScreen();

      const headings = screen.getAllByTestId(
        /^(email-and-linked-accounts-section|two-factor-section|password-section)$/,
      );
      expect(headings.length).toBeGreaterThanOrEqual(3);
      expect(screen.getByTestId("email-and-linked-accounts-section")).toBeTruthy();
      expect(screen.getByTestId("two-factor-section")).toBeTruthy();
      expect(screen.getByTestId("password-section")).toBeTruthy();
    });
  });
});

describe("given a self-hosted deployment", () => {
  describe("when it holds no Enterprise license", () => {
    /** @scenario "An unlicensed deployment sees what a license would unlock" */
    it("lists what a license would unlock rather than hiding it", () => {
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
          authProvider: undefined,
        },
      });

      const section = screen.getByTestId("enterprise-capabilities");
      expect(within(section).getByText("Single sign-on")).toBeTruthy();
      expect(within(section).getByText("SCIM provisioning")).toBeTruthy();
      expect(within(section).getByText("Audit logs")).toBeTruthy();
      expect(within(section).getAllByText("Enterprise license")).toHaveLength(3);
    });

    /** @scenario "An unlicensed deployment is told how to obtain a license" */
    it("offers the way to activate one", () => {
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
          authProvider: undefined,
        },
      });

      expect(screen.getByRole("link", { name: /Activate a license/i })).toBeTruthy();
    });
  });

  describe("when it holds one", () => {
    /** @scenario "A licensed deployment sees the capabilities as available" */
    it("marks the capabilities as available and stops selling", () => {
      state.planType = "ENTERPRISE";
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
          authProvider: undefined,
        },
      });

      const section = screen.getByTestId("enterprise-capabilities");
      expect(within(section).getAllByText("Available")).toHaveLength(3);
      expect(screen.queryByRole("link", { name: /Activate a license/i })).toBeNull();
    });
  });

  describe("when single sign-on is configured but unlicensed", () => {
    /** @scenario "An operator whose single sign-on is configured but unlicensed is told so" */
    it("names the license as the cause", () => {
      state.ssoGate = { configuredProvider: "okta", licensed: false, mounted: false };
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
          authProvider: undefined,
        },
      });

      expect(screen.getByTestId("sso-unlicensed-notice")).toBeTruthy();
      expect(screen.queryByTestId("sso-not-started-notice")).toBeNull();
    });
  });

  describe("when single sign-on is licensed but never started", () => {
    /** @scenario "An operator whose identity provider could not be started is told so" */
    it("names the provider as the cause instead", () => {
      state.ssoGate = { configuredProvider: "okta", licensed: true, mounted: false };
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
          authProvider: undefined,
        },
      });

      expect(screen.getByTestId("sso-not-started-notice")).toBeTruthy();
    });
  });

  describe("when single sign-on is licensed and running", () => {
    it("says nothing about it", () => {
      state.ssoGate = { configuredProvider: "okta", licensed: true, mounted: true };
      renderScreen({
        deployment: {
          isSaas: false,
          appBaseUrl: "https://langwatch.internal",
          passkeysEnabled: false,
          authProvider: undefined,
        },
      });

      expect(screen.queryByTestId("sso-unlicensed-notice")).toBeNull();
      expect(screen.queryByTestId("sso-not-started-notice")).toBeNull();
    });
  });
});

describe("given LangWatch Cloud", () => {
  describe("when the page renders", () => {
    /** @scenario "Cloud hides the self-hosted licensing section" */
    it("hides the self-hosted licensing section entirely", () => {
      renderScreen();

      expect(screen.queryByTestId("enterprise-capabilities")).toBeNull();
    });
  });
});
