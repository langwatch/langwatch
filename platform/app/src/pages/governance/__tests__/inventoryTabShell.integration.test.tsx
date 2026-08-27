/**
 * @vitest-environment jsdom
 *
 * The inventory page is a tabbed shell whose selected tab is part of the
 * address (?tab=), with a permission-sensitive default: Catalog (the
 * tool-tiles editor) for admins holding aiTools:manage, Sources for
 * everyone else. These tests mount the real page inside a memory router —
 * the tab value is read from the router's search params, so the assertions
 * run against the same address the user sees: the default is never written
 * to the URL, and an unknown value degrades to the default instead of a
 * blank pane.
 *
 * Only the boundaries are mocked, the same set as the delegated-viewer
 * suite: layout chrome, feature flag, plan, and the tRPC client. The tab
 * selection and what mounts inside each pane are the real page's doing.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
  /** The persona under test; beforeEach resets to the delegated viewer. */
  permissions: [] as string[],
}));

/** The org-member floor plus the governance product grant and sources read. */
const VIEWER_PERMISSIONS = [
  "organization:view",
  "governance:view",
  "ingestionSources:view",
];

/** The viewer set plus the catalog's own grant. */
const CATALOG_ADMIN_PERMISSIONS = [...VIEWER_PERMISSIONS, "aiTools:manage"];

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(harness.permissions, permission);
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
    pathname: "/governance/inventory",
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

import InventoryPage from "../inventory.enterprise";

function renderInventoryAt(initialEntries: string[]) {
  const router = createMemoryRouter(
    [{ path: "/governance/inventory", Component: InventoryPage }],
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
  harness.permissions = VIEWER_PERMISSIONS;
});

afterEach(() => cleanup());

describe("the inventory tab shell", () => {
  describe("when an aiTools:manage admin opens the bare address", () => {
    /** @scenario "The inventory default tab stays out of the address" */
    it("selects Catalog, mounts the tool-tiles editor, and writes no tab parameter", () => {
      harness.permissions = CATALOG_ADMIN_PERMISSIONS;
      const router = renderInventoryAt(["/governance/inventory"]);

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The editor body carries its own inner tab strip, unchanged from
      // the retired tool-catalog page.
      expect(screen.getByRole("tab", { name: "Tool Tiles" })).toBeVisible();
      expect(router.state.location.search).not.toContain("tab");
    });
  });

  describe("when an aiTools:manage admin addresses the Sources tab", () => {
    /** @scenario "The Sources tab is addressable" */
    it("selects Sources and mounts the table", () => {
      harness.permissions = CATALOG_ADMIN_PERMISSIONS;
      renderInventoryAt(["/governance/inventory?tab=sources"]);

      expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("ingestionSources.list");
    });
  });

  describe("when a delegated viewer opens the bare address", () => {
    /** @scenario "A delegated viewer without aiTools:manage defaults to Sources" */
    it("selects Sources, mounts the table, and writes no tab parameter", () => {
      const router = renderInventoryAt(["/governance/inventory"]);

      expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("ingestionSources.list");
      expect(router.state.location.search).not.toContain("tab");
    });

    /** @scenario "A delegated viewer without aiTools:manage defaults to Sources" */
    it("still lists the Catalog tab, which shows the permission notice in-pane", async () => {
      renderInventoryAt(["/governance/inventory"]);

      const catalogTab = screen.getByRole("tab", { name: "Catalog" });
      fireEvent.click(catalogTab);

      // Selection round-trips through the router (?tab=catalog), and the
      // pane mounts a tick after the trigger's aria state flips.
      await waitFor(() =>
        expect(catalogTab).toHaveAttribute("aria-selected", "true"),
      );
      expect(await screen.findByText(/aiTools:manage/)).toBeVisible();
    });
  });

  describe("when the address carries an unknown tab value", () => {
    /** @scenario "An unknown tab value falls back to the default" */
    it("selects the admin default and mounts the editor instead of a blank pane", () => {
      harness.permissions = CATALOG_ADMIN_PERMISSIONS;
      renderInventoryAt(["/governance/inventory?tab=nonsense"]);

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tab", { name: "Tool Tiles" })).toBeVisible();
    });
  });
});
