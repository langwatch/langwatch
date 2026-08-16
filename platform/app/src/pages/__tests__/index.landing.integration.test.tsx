/**
 * @vitest-environment jsdom
 *
 * The "/" landing seam: in a new navigation mode the per-org product
 * memory decides ahead of the server resolver, and in legacy mode the
 * current resolveHomeDestination path runs unchanged.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn().mockResolvedValue(true);
let mockMode: "legacy" | "product-switcher" = "product-switcher";
let mockResolveHome: {
  data?: { destination: string; isOverride: boolean } & Record<string, unknown>;
  isError: boolean;
} = { isError: false };

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/",
    query: {},
    asPath: "/",
    push: vi.fn(),
    replace: replaceMock,
  }),
}));

vi.mock("~/features/navigation/useNavigationMode", () => ({
  useNavigationMode: () => ({ status: "ready", mode: mockMode }),
}));

vi.mock("~/features/navigation/useReachableProducts", () => ({
  useReachableProducts: () => ({
    reachableProducts: ["me", "llm-ops", "gateway", "governance"],
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org_1" },
    organizations: [{ id: "org_1" }],
    project: { id: "project_1", slug: "demo", isPersonal: false },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    governance: {
      resolveHome: { useQuery: () => mockResolveHome },
    },
  },
}));

vi.mock("../../components/LoadingScreen", () => ({
  LoadingScreen: () => null,
}));

import { writeLastVisitedProduct } from "~/features/navigation/logic/productMemory";
import Index from "../index";

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
      writeLastVisitedProduct({
        organizationId: "org_1",
        productId: "gateway",
      });
      render(<Index />);

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/gateway/virtual-keys");
      });
    });

    it("still honours an explicit pin over the memory", async () => {
      writeLastVisitedProduct({
        organizationId: "org_1",
        productId: "gateway",
      });
      mockResolveHome = {
        data: {
          destination: "/governance",
          isOverride: true,
          intentPinned: false,
          governanceUiEnabled: true,
        },
        isError: false,
      };
      render(<Index />);

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/governance");
      });
    });
  });

  describe("when the landing page re-renders while the navigation is in flight", () => {
    /** @scenario The landing redirect navigates once per destination */
    it("navigates once per destination", async () => {
      mockMode = "legacy";
      const { rerender } = render(<Index />);

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/demo");
      });

      // Every mocked hook above returns a fresh object per call, the way
      // the real hooks behave while a lazy route is loading. A re-render
      // must not restart the same navigation.
      rerender(<Index />);
      rerender(<Index />);

      expect(replaceMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the device is in legacy mode", () => {
    /** @scenario The root address keeps its current behavior in legacy mode */
    it("resolves through the current home resolution, ignoring the memory", async () => {
      mockMode = "legacy";
      writeLastVisitedProduct({
        organizationId: "org_1",
        productId: "governance",
      });
      render(<Index />);

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/demo");
      });
    });
  });
});
