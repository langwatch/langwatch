/**
 * @vitest-environment jsdom
 *
 * The "/" landing seam: in a new navigation mode the per-org product
 * memory decides ahead of the server resolver, and in legacy mode the
 * current resolveHomeDestination path runs unchanged.
 *
 * MOVED from `platform/app/src/pages/__tests__/index.landing.integration.test.tsx`.
 * The three mocks that named that application's modules — its router, its
 * workspace hook and its tRPC client — are one stub host and one stubbed
 * procedure map now; the scenarios and their expectations are unchanged.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
let mockMode: "legacy" | "product-switcher" = "product-switcher";
let mockResolveHome: {
  data?: { destination: string; isOverride: boolean } & Record<string, unknown>;
  isError: boolean;
} = { isError: false };

vi.mock("../../../behavior/use-navigation-mode", () => ({
  useNavigationMode: () => ({ status: "ready", mode: mockMode }),
}));

vi.mock("../../../behavior/use-reachable-products", () => ({
  useReachableProducts: () => ({
    reachableProducts: ["me", "llm-ops", "gateway", "governance"],
    isLoading: false,
  }),
}));

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    governance: {
      resolveHome: { useQuery: () => mockResolveHome },
    },
  },
}));

import { writeLastVisitedProduct } from "../../../model/product-memory";
import { WithStubNavigationHost } from "../../../testing";
import LandingScreen from "../landing.screen";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };
const PROJECT = { id: "project_1", name: "Demo", slug: "demo", isPersonal: false };

function renderLanding() {
  return render(
    <WithStubNavigationHost
      readings={{
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        project: PROJECT,
        isLoading: false,
      }}
      actions={{ replace: replaceMock }}
    >
      <LandingScreen />
    </WithStubNavigationHost>,
  );
}

beforeEach(() => {
  localStorage.clear();
  replaceMock.mockClear();
  mockMode = "product-switcher";
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
  describe("when a new mode remembers a product", () => {
    /** @scenario The root address opens the remembered product in a new mode */
    it("opens the remembered product ahead of the server resolver", async () => {
      writeLastVisitedProduct({ organizationId: "org_1", productId: "gateway" });
      renderLanding();

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/gateway/virtual-keys");
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

  describe("when the landing page re-renders while the navigation is in flight", () => {
    /** @scenario The landing redirect navigates once per destination */
    it("navigates once per destination", async () => {
      mockMode = "legacy";
      const { rerender } = renderLanding();

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/demo");
      });

      // Every mocked hook above returns a fresh object per call, the way
      // the real hooks behave while a lazy route is loading. A re-render
      // must not restart the same navigation.
      rerender(
        <WithStubNavigationHost
          readings={{
            organization: ORGANIZATION,
            organizations: [ORGANIZATION],
            project: PROJECT,
            isLoading: false,
          }}
          actions={{ replace: replaceMock }}
        >
          <LandingScreen />
        </WithStubNavigationHost>,
      );

      expect(replaceMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the device is in legacy mode", () => {
    /** @scenario The root address keeps its current behavior in legacy mode */
    it("resolves through the current home resolution, ignoring the memory", async () => {
      mockMode = "legacy";
      writeLastVisitedProduct({ organizationId: "org_1", productId: "governance" });
      renderLanding();

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/demo");
      });
    });
  });
});
