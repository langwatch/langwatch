/**
 * @vitest-environment jsdom
 *
 * The "/" landing seam: the per-org product memory decides ahead of the
 * server home resolver, and re-renders during the in-flight navigation
 * never restart the same replace.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn().mockResolvedValue(true);
let mockResolveHome: {
  data?: { destination: string; isOverride: boolean } & Record<string, unknown>;
  isError: boolean;
} = { isError: false };
let mockWorkspace: Record<string, unknown> = {};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/",
    query: {},
    asPath: "/",
    push: vi.fn(),
    replace: replaceMock,
  }),
}));

vi.mock("~/features/navigation/useReachableProducts", () => ({
  useReachableProducts: () => ({
    reachableProducts: ["me", "llm-ops", "gateway", "governance"],
    isLoading: false,
  }),
}));

// Only the hook is stubbed. The access helpers beside it are pure, and the
// project this fixture resolves is the organization's, so they answer with it.
vi.mock("~/hooks/useOrganizationTeamProject", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganizationTeamProject: () => mockWorkspace,
}));

// Stubbed to markers rather than rendered: what this file checks is WHICH of
// the two surfaces "/" draws, not what either one says. The words on the
// failure come from the code-keyed registry and are tested where it lives.
vi.mock("~/features/errors", () => ({
  HandledErrorState: () => <div data-testid="workspace-failed" />,
}));

vi.mock("~/utils/api", () => ({
  api: {
    governance: {
      resolveHome: { useQuery: () => mockResolveHome },
    },
  },
}));

vi.mock("../../components/LoadingScreen", () => ({
  LoadingScreen: () => <div data-testid="loading-screen" />,
}));

import { writeLastVisitedProduct } from "~/features/navigation/logic/productMemory";
import Index from "../index";

beforeEach(() => {
  localStorage.clear();
  replaceMock.mockClear();
  mockWorkspace = {
    isLoading: false,
    workspaceError: null,
    organization: { id: "org_1" },
    organizations: [{ id: "org_1" }],
    project: { id: "project_1", slug: "demo", isPersonal: false },
  };
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

  describe("when the organization graph refused the read", () => {
    /** @scenario The landing address says a refused read failed rather than waiting on it */
    it("says the workspace could not be opened instead of waiting on it", () => {
      mockWorkspace = {
        isLoading: false,
        workspaceError: new Error("UNAUTHORIZED"),
        organization: undefined,
        organizations: undefined,
        project: undefined,
      };
      // The home resolver is asked for an organization, so a refused graph
      // leaves it switched off and answerless — there is no second source the
      // page could have fallen back to.
      mockResolveHome = { isError: false };

      const { queryByTestId } = render(<Index />);

      // The redirect never comes for a graph that will not answer, so the
      // loading screen this page shows while deciding would be permanent.
      expect(queryByTestId("workspace-failed")).not.toBeNull();
      expect(queryByTestId("loading-screen")).toBeNull();
      expect(replaceMock).not.toHaveBeenCalled();
    });
  });
});
