/**
 * @vitest-environment jsdom
 *
 * The catalog page is a tabbed shell whose selected tab is part of the
 * address (?tab=), with Sources as the only tab today and therefore the
 * default. These tests mount the real page inside a memory router — the tab
 * value is read from the router's search params, so the assertions run
 * against the same address the user sees: the default is never written to
 * the URL, and an unknown value degrades to Sources instead of a blank pane.
 *
 * Only the boundaries are mocked, the same set as the delegated-viewer
 * suite: layout chrome, feature flag, plan, and the tRPC client. The tab
 * selection and the table mounting inside it are the real page's doing.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
}));

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  // The production shape of a delegated viewer who can read sources: the
  // org-member floor, the governance product grant, and the sources read.
  const permissions = [
    "organization:view",
    "governance:view",
    "ingestionSources:view",
  ];
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/enterprise/EnterpriseLockedSurface", () => ({
  EnterpriseLockedSurface: ({ children }: { children: React.ReactNode }) =>
    children,
}));

vi.mock("~/components/governance/QuarantineFillAlert", () => ({
  QuarantineFillAlert: () => null,
}));

vi.mock("~/components/me/InstallCliCard", () => ({
  InstallCliCard: () => null,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/catalog",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false)
                harness.requested.push(path.join("."));
              return queryResult();
            };
          }
          if (property === "useMutation") return mutationResult;
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import IngestionSourcesPage from "@ee/governance/dashboard/pages/ingestion-sources";

function renderCatalogAt(initialEntries: string[]) {
  const router = createMemoryRouter(
    [{ path: "/governance/catalog", Component: IngestionSourcesPage }],
    { initialEntries },
  );
  render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
  return router;
}

beforeEach(() => {
  harness.requested = [];
});

afterEach(() => cleanup());

describe("the catalog tab shell", () => {
  describe("when the catalog is opened at its bare address", () => {
    /** @scenario "The catalog default tab stays out of the address" */
    it("selects Sources, mounts the table, and writes no tab parameter", () => {
      const router = renderCatalogAt(["/governance/catalog"]);

      expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("ingestionSources.list");
      expect(router.state.location.search).not.toContain("tab");
    });
  });

  describe("when the address carries an unknown tab value", () => {
    /** @scenario "An unknown tab value falls back to Sources" */
    it("selects Sources and mounts the table instead of a blank pane", () => {
      renderCatalogAt(["/governance/catalog?tab=nonsense"]);

      expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("ingestionSources.list");
    });
  });
});
