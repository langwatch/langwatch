/**
 * @vitest-environment jsdom
 *
 * The inventory page is a tabbed shell whose selected tab is part of the
 * address (?tab=), defaulting to Catalog — the catalog of connected tools —
 * for every reader. The default used to depend on the reader's grants,
 * because Catalog was then the tool-tiles editor and only aiTools:manage
 * holders could use it; the tiles left the page and the pane that replaced
 * them reads the same source list the Sources tab does, so one bare link no
 * longer opens two panes. These tests mount the real page inside a memory
 * router —
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
  /** The plan under test; beforeEach resets to Enterprise. */
  isEnterprise: true,
}));

/** The org-member floor plus the governance product grant and sources read. */
const VIEWER_PERMISSIONS = [
  "organization:view",
  "governance:view",
  "ingestionSources:view",
];

/** The org-member floor with no sources read: the catalog's gate is closed. */
const NO_SOURCES_READ_PERMISSIONS = ["organization:view", "governance:view"];

/** The viewer set plus the retired tiles grant, which now changes nothing. */
const CATALOG_ADMIN_PERMISSIONS = [...VIEWER_PERMISSIONS, "aiTools:manage"];

/** The catalog admin plus the sources write grant. */
const SOURCES_ADMIN_PERMISSIONS = [
  ...CATALOG_ADMIN_PERMISSIONS,
  "ingestionSources:manage",
];

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
  useActivePlan: () => ({
    isEnterprise: harness.isEnterprise,
    isLoading: false,
    activePlan: undefined,
  }),
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

import InventoryPage from "@ee/governance/dashboard/pages/inventory";

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
  // The section keeps ONE sample choice for the whole sitting, in session
  // storage, so a test that presses the toggle would otherwise hand its
  // answer to the next one.
  window.sessionStorage.clear();
  harness.requested = [];
  harness.permissions = VIEWER_PERMISSIONS;
  harness.isEnterprise = true;
});

afterEach(() => cleanup());

describe("the inventory tab shell", () => {
  describe("when an admin opens the bare address", () => {
    /** @scenario "The inventory default tab stays out of the address" */
    it("selects Catalog, mounts the tools catalog, and writes no tab parameter", () => {
      harness.permissions = CATALOG_ADMIN_PERMISSIONS;
      const router = renderInventoryAt(["/governance/inventory"]);

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The pane is the catalog of connected tools. This mock answers every
      // read with undefined, so the catalog is genuinely empty and says so —
      // the point of the assertion is which pane mounted, not how full it is.
      expect(screen.getByTestId("tool-catalog-empty")).toBeVisible();
      // The retired tile editor and its inner tab strip are off this page.
      expect(screen.queryByRole("tab", { name: "Tool Tiles" })).toBeNull();
      expect(router.state.location.search).not.toContain("tab");
    });
  });

  describe("when an aiTools:manage admin addresses the Sources tab", () => {
    /** @scenario "The Sources tab is addressable" */
    it("selects Sources and mounts the table", () => {
      harness.permissions = CATALOG_ADMIN_PERMISSIONS;
      renderInventoryAt(["/governance/inventory?tab=sources"]);

      expect(screen.getByRole("tab", { name: /^Sources/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(harness.requested).toContain("ingestionSources.list");
    });
  });

  describe("when a delegated viewer without aiTools:manage opens the bare address", () => {
    /** @scenario "The bare address opens the same pane for every reader" */
    it("lands on Catalog, the same pane the admin gets, and writes no tab parameter", () => {
      const router = renderInventoryAt(["/governance/inventory"]);

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The catalog is built from the source list, so landing here issues
      // the read this viewer's ingestionSources:view already allows.
      expect(harness.requested).toContain("ingestionSources.list");
      expect(router.state.location.search).not.toContain("tab");
    });

    /** @scenario "The Sources tab is addressable" */
    it("can still reach Sources, which selects and writes the tab parameter", async () => {
      const router = renderInventoryAt(["/governance/inventory"]);

      const sourcesTab = screen.getByRole("tab", { name: /^Sources/ });
      fireEvent.click(sourcesTab);

      // Selection round-trips through the router, and the pane mounts a tick
      // after the trigger's aria state flips.
      await waitFor(() =>
        expect(sourcesTab).toHaveAttribute("aria-selected", "true"),
      );
      expect(router.state.location.search).toContain("tab=sources");
    });
  });

  describe("when the reader holds no ingestionSources:view", () => {
    // The catalog reads the source list, so with the read refused there is
    // nothing to draw. What must NOT happen is the empty state: it would tell
    // this reader their organization has registered no AI tools, which is a
    // confident wrong answer where the honest one is "you cannot see".
    /** @scenario "A reader without ingestionSources:view meets the grant, not an empty catalog" */
    it("still selects Catalog, and names the grant instead of reporting no tools", () => {
      harness.permissions = NO_SOURCES_READ_PERMISSIONS;
      renderInventoryAt(["/governance/inventory"]);

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByText(/ingestionSources:view/)).toBeVisible();
      expect(screen.queryByTestId("tool-catalog-empty")).toBeNull();
      expect(harness.requested).not.toContain("ingestionSources.list");
    });
  });

  describe("when an admin arrives on the retired anomaly-rules tab value", () => {
    // The redirect at src/legacyRedirects.tsx pins tab=anomaly-rules onto the
    // inventory address, and that pane is gone. This is therefore a live
    // address, not a hypothetical one, and it has to land somewhere real.
    /** @scenario "The retired anomaly-rules tab value lands on the catalog" */
    it("lists no Anomaly rules tab and falls back to the catalog", () => {
      harness.permissions = [...CATALOG_ADMIN_PERMISSIONS, "anomalyRules:view"];
      renderInventoryAt(["/governance/inventory?tab=anomaly-rules"]);

      expect(screen.queryByRole("tab", { name: /anomaly/i })).toBeNull();
      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // Not merely "a tab is selected": the pane behind it has to have
      // rendered, or this passes on a selected tab over an empty body.
      //
      // Observed through the pane's own testid rather than through the tRPC
      // call it was checked by before. That query is issued by
      // useIngestionSourcesPage at page level, so it fires on whichever tab is
      // selected — a control run with tab=sources records it while the catalog
      // is not mounted at all. It proved the page loaded, never this pane.
      expect(screen.getByTestId("tool-catalog-empty")).toBeInTheDocument();
    });
  });

  describe("when the address carries an add parameter for an offered type", () => {
    /** @scenario "An add parameter opens the composer on that source type and leaves the address" */
    it("opens the composer on that type and strips the parameter", async () => {
      harness.permissions = SOURCES_ADMIN_PERMISSIONS;
      const router = renderInventoryAt([
        "/governance/inventory?tab=sources&add=claude_code",
      ]);

      expect(
        await screen.findByRole("heading", { name: /Add Claude Code/ }),
      ).toBeVisible();
      await waitFor(() =>
        expect(router.state.location.search).toBe("?tab=sources"),
      );
    });
  });

  describe("when the address carries an add parameter for a plan-locked type", () => {
    /** @scenario "A locked add parameter is ignored and leaves the address" */
    it("opens nothing and still strips the parameter", async () => {
      harness.permissions = SOURCES_ADMIN_PERMISSIONS;
      harness.isEnterprise = false;
      const router = renderInventoryAt([
        "/governance/inventory?tab=sources&add=claude_code",
      ]);

      await waitFor(() =>
        expect(router.state.location.search).toBe("?tab=sources"),
      );
      expect(
        screen.queryByRole("heading", { name: /Add Claude Code/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the address carries an unknown tab value", () => {
    /** @scenario "An unknown tab value falls back to the default" */
    it("selects the default and mounts the catalog instead of a blank pane", () => {
      harness.permissions = CATALOG_ADMIN_PERMISSIONS;
      renderInventoryAt(["/governance/inventory?tab=nonsense"]);

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("tool-catalog-empty")).toBeVisible();
    });
  });
});
