/**
 * @vitest-environment jsdom
 *
 * See specs/licensing/self-hosted-enterprise-discovery.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publicEnvMock, activePlanMock, ssoGateRef } = vi.hoisted(() => ({
  publicEnvMock: vi.fn(),
  activePlanMock: vi.fn(),
  ssoGateRef: {
    current: undefined as
      | { configuredProvider: string | null; licensed: boolean }
      | undefined,
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({ usePublicEnv: publicEnvMock }));
vi.mock("~/hooks/useActivePlan", () => ({ useActivePlan: activePlanMock }));
vi.mock("~/utils/api", () => ({
  api: {
    license: {
      getSsoGateStatus: {
        useQuery: () => ({ data: ssoGateRef.current }),
      },
    },
  },
}));

import { EnterpriseCapabilitiesSection } from "../EnterpriseCapabilitiesSection";

const renderSection = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <EnterpriseCapabilitiesSection />
    </ChakraProvider>,
  );

const selfHosted = () =>
  publicEnvMock.mockReturnValue({ data: { IS_SAAS: false } });
const cloud = () => publicEnvMock.mockReturnValue({ data: { IS_SAAS: true } });

describe("<EnterpriseCapabilitiesSection />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activePlanMock.mockReturnValue({ isEnterprise: false, isLoading: false });
    // The common shape: no identity provider configured, so there is nothing
    // for the unlicensed-SSO notice to report.
    ssoGateRef.current = { configuredProvider: null, licensed: true };
  });

  afterEach(cleanup);

  describe("given a self-hosted deployment with no license", () => {
    /** @scenario An unlicensed deployment sees what a license would unlock */
    it("lists single sign-on, SCIM and audit logs, each marked as needing an Enterprise license", () => {
      selfHosted();
      renderSection();

      expect(screen.getByText("Single sign-on")).toBeDefined();
      expect(screen.getByText("SCIM provisioning")).toBeDefined();
      expect(screen.getByText("Audit logs")).toBeDefined();
      expect(screen.getAllByText("Enterprise license")).toHaveLength(3);
    });

    /** @scenario An unlicensed deployment sees what a license would unlock */
    it("links each capability to its setup guide in a new tab", () => {
      selfHosted();
      renderSection();

      const guides = screen.getAllByRole("link", { name: /setup guide/i });
      expect(guides).toHaveLength(3);
      for (const guide of guides) {
        expect(guide.getAttribute("target")).toBe("_blank");
        expect(guide.getAttribute("href")).toContain("docs.langwatch.ai");
      }
    });

    /** @scenario An unlicensed deployment is told how to obtain a license */
    it("offers the licensing guide and the activation page", () => {
      selfHosted();
      renderSection();

      expect(
        screen
          .getByRole("link", { name: /how licensing works/i })
          .getAttribute("href"),
      ).toBe("https://docs.langwatch.ai/self-hosting/licensing");
      expect(
        screen
          .getByRole("link", { name: /activate a license/i })
          .getAttribute("href"),
      ).toBe("/settings/license");
    });

    it("states that the rest of the platform stays uncapped", () => {
      selfHosted();
      renderSection();

      expect(
        screen.getByText(/unlimited members, teams, and projects/i),
      ).toBeDefined();
    });
  });

  describe("given a self-hosted deployment with an Enterprise license", () => {
    /** @scenario A licensed deployment sees the capabilities as available */
    it("presents the capabilities as available rather than as an upgrade", () => {
      selfHosted();
      activePlanMock.mockReturnValue({ isEnterprise: true, isLoading: false });
      renderSection();

      expect(screen.getAllByText("Available")).toHaveLength(3);
      expect(screen.queryByText("Enterprise license")).toBeNull();
      expect(
        screen.queryByRole("link", { name: /activate a license/i }),
      ).toBeNull();
    });
  });

  describe("given LangWatch Cloud", () => {
    /** @scenario Cloud hides the self-hosted licensing section */
    it("renders nothing", () => {
      cloud();
      const { container } = renderSection();

      expect(
        container.querySelector("[data-testid='enterprise-capabilities']"),
      ).toBeNull();
    });
  });

  describe("given single sign-on is configured but the deployment is unlicensed", () => {
    beforeEach(() => {
      selfHosted();
      ssoGateRef.current = { configuredProvider: "auth0", licensed: false };
    });

    /** @scenario An operator whose single sign-on is configured but unlicensed is told so */
    it("names the configured provider and says why nobody is using it", () => {
      renderSection();

      expect(screen.getByTestId("sso-unlicensed-notice")).toBeTruthy();
      expect(screen.getByText(/configured but not licensed/i)).toBeTruthy();
      expect(screen.getByText("auth0")).toBeTruthy();
      expect(screen.getByText(/signing in by email/i)).toBeTruthy();
    });
  });

  describe("given single sign-on is configured and licensed", () => {
    it("says nothing, because there is nothing to explain", () => {
      selfHosted();
      ssoGateRef.current = { configuredProvider: "auth0", licensed: true };

      renderSection();

      expect(screen.queryByTestId("sso-unlicensed-notice")).toBeNull();
    });
  });

  describe("given no identity provider is configured at all", () => {
    it("says nothing, since the deployment never asked for single sign-on", () => {
      selfHosted();
      ssoGateRef.current = { configuredProvider: null, licensed: true };

      renderSection();

      expect(screen.queryByTestId("sso-unlicensed-notice")).toBeNull();
    });
  });
});
