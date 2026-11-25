/**
 * @vitest-environment jsdom
 *
 * Landing page (/): per-org product memory resolves before server. Moved from platform/app.
 */

import { render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
let mockResolveHome: {
  data?: { destination: string; isOverride: boolean } & Record<string, unknown>;
  isError: boolean;
} = { isError: false };
let mockTestArrival: { data?: { testing: boolean }; isLoading: boolean } = {
  data: { testing: false },
  isLoading: false,
};
/** Both organization Dashboards flags answer alike; off unless a test says otherwise. */
const ORGANIZATION_FLAGS_OFF = { data: { enabledByOrganizationId: {} }, isLoading: false };
let mockOrganizationFlags: {
  data?: { enabledByOrganizationId: Record<string, boolean> };
  isLoading: boolean;
} = ORGANIZATION_FLAGS_OFF;

vi.mock("../../../../behavior/use-reachable-products.ts", () => ({
  useReachableProducts: () => ({
    reachableProducts: ["me", "llm-ops", "dashboards", "gateway", "governance"],
    isLoading: false,
  }),
}));

vi.mock("../../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    governance: {
      resolveHome: { useQuery: () => mockResolveHome },
    },
    identity: {
      myTestArrival: { useQuery: () => mockTestArrival },
    },
    featureFlag: {
      isEnabledForEachOrganization: { useQuery: () => mockOrganizationFlags },
    },
  },
}));

import { useNavigationTracking } from "../../../../behavior/use-navigation-tracking.ts";
import { writeLastVisitedProduct } from "../../../../model/product-memory.ts";
import { WithStubNavigationHost } from "../../../../testing.tsx";
import LandingScreen from "../landing.screen.tsx";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };
const PROJECT = { id: "project_1", name: "Demo", slug: "demo", isPersonal: false };

function renderLanding({ orgless = false }: { orgless?: boolean } = {}) {
  return render(landingScreen({ orgless }));
}

function landingScreen({ orgless }: { orgless: boolean }) {
  return (
    <WithStubNavigationHost
      readings={{
        organization: orgless ? undefined : ORGANIZATION,
        organizations: orgless ? [] : [ORGANIZATION],
        project: orgless ? undefined : PROJECT,
        isLoading: false,
      }}
      actions={{ replace: replaceMock }}
    >
      <LandingScreen />
    </WithStubNavigationHost>
  );
}

beforeEach(() => {
  localStorage.clear();
  replaceMock.mockClear();
  mockTestArrival = { data: { testing: false }, isLoading: false };
  mockOrganizationFlags = ORGANIZATION_FLAGS_OFF;
  mockResolveHome = {
    data: {
      destination: "/demo",
      isOverride: false,
      intentPinned: false,
      governanceUiEnabled: true,
    },
    isError: false,
  };
});

describe("the root landing", () => {
  describe("when the device remembers a product", () => {
    /** @scenario The root address opens the remembered product */
    it("opens the remembered product ahead of the server resolver", async () => {
      writeLastVisitedProduct({ organizationId: "org_1", productId: "gateway" });
      renderLanding();

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/gateway/virtual-keys");
      });
    });

    /** @scenario "AC3l Opening Dashboards from the Analytics entry makes Dashboards the remembered product" */
    it("lands on Dashboards after the Analytics entry took the member there", async () => {
      renderHook(() => useNavigationTracking(), {
        wrapper: ({ children }) => (
          <WithStubNavigationHost
            readings={{
              organization: ORGANIZATION,
              organizations: [ORGANIZATION],
              project: PROJECT,
              pathname: "/demo/dashboards",
            }}
          >
            {children}
          </WithStubNavigationHost>
        ),
      });
      renderLanding();

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/demo/dashboards");
      });
    });

    it("still honours an explicit pin over the memory", async () => {
      writeLastVisitedProduct({ organizationId: "org_1", productId: "gateway" });
      mockResolveHome = {
        data: {
          destination: "/governance",
          isOverride: true,
          intentPinned: false,
          governanceUiEnabled: true,
        },
        isError: false,
      };
      renderLanding();

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/governance");
      });
    });
  });

  describe("when the device remembers Dashboards and the organization's library flags load", () => {
    /** @scenario "The root address waits for the library's flags before landing on Dashboards" */
    it("holds the redirect until the flags answer, then lands on the library", async () => {
      writeLastVisitedProduct({ organizationId: "org_1", productId: "dashboards" });
      mockOrganizationFlags = { data: undefined, isLoading: true };
      const { rerender } = renderLanding();

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(replaceMock).not.toHaveBeenCalled();

      mockOrganizationFlags = {
        data: { enabledByOrganizationId: { org_1: true } },
        isLoading: false,
      };
      rerender(landingScreen({ orgless: false }));

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/dashboards");
      });
      expect(replaceMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the landing page re-renders while the navigation is in flight", () => {
    /** @scenario The landing redirect navigates once per destination */
    it("navigates once per destination", async () => {
      const { rerender } = renderLanding();

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/demo");
      });

      // Every mocked hook above returns a fresh object per call, the way
      // the real hooks behave while a lazy route is loading. A re-render
      // must not restart the same navigation.
      rerender(landingScreen({ orgless: false }));

      expect(replaceMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a test sign-in leaves somebody with no organization", () => {
    // With no organization the home query is disabled, so it never answers.
    beforeEach(() => {
      mockResolveHome = { isError: false };
    });

    /** @scenario A test sign-in that returns to the setup screen is sent to what happened */
    it("sends them to the test sign-in result, not to onboarding", async () => {
      mockTestArrival = { data: { testing: true }, isLoading: false };
      renderLanding({ orgless: true });

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/auth/sso-test-complete");
      });
      expect(replaceMock).not.toHaveBeenCalledWith("/onboarding/welcome");
    });

    /** @scenario A test sign-in that returns to the setup screen is sent to what happened */
    it("sends them nowhere while the server has not answered", async () => {
      mockTestArrival = { data: undefined, isLoading: true };
      renderLanding({ orgless: true });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(replaceMock).not.toHaveBeenCalled();
    });

    /** @scenario A test sign-in that returns to the setup screen is sent to what happened */
    it("still sends somebody who is not a test arrival to onboarding", async () => {
      renderLanding({ orgless: true });

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/onboarding/welcome");
      });
    });
  });
});
