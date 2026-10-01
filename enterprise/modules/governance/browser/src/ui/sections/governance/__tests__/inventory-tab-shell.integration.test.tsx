// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment jsdom
 * The inventory tab shell: ?tab= in the address, defaulting to Catalog for every reader.
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeGovernanceHost,
  renderWithGovernanceHost,
  type GovernanceQuery,
} from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
}));

/** The org-member floor plus the governance product grant and sources read. */
const VIEWER_PERMISSIONS = ["organization:view", "governance:view", "ingestionSources:view"];

/** The viewer set plus the catalog's own grant. */
const CATALOG_ADMIN_PERMISSIONS = [...VIEWER_PERMISSIONS, "aiTools:manage"];

/** The org-member floor alone: neither the registry nor the source read. */
const NO_SOURCES_READ_PERMISSIONS = ["organization:view", "governance:view"];

/** The catalog admin plus the sources write grant. */
const SOURCES_ADMIN_PERMISSIONS = [...CATALOG_ADMIN_PERMISSIONS, "ingestionSources:manage"];

vi.mock("../../../../behavior/governance-api.ts", () => {
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
              if (options?.enabled !== false) harness.requested.push(path.join("."));
              return queryResult();
            };
          }
          if (property === "useMutation") return mutationResult;
          // The utils client's imperative methods are called, not walked, so
          // they have to be functions rather than another proxy node.
          if (["invalidate", "setData", "fetch", "cancel", "prefetch"].includes(property))
            return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  const api = node([]);
  return { api, governanceApi: api };
});

import InventoryPage from "../governance-inventory.screen.tsx";

function renderInventoryAt({
  permissions,
  query = {},
  isEnterprise = true,
}: {
  permissions: readonly string[];
  query?: GovernanceQuery;
  isEnterprise?: boolean;
}) {
  const host = fakeGovernanceHost({
    permissions,
    query,
    plan: { isEnterprise, isLoading: false },
  });
  renderWithGovernanceHost(<InventoryPage />, { host });
  return host;
}

beforeEach(() => {
  window.sessionStorage.clear();
  harness.requested = [];
});

afterEach(() => cleanup());

describe("the inventory tab shell", () => {
  /** @scenario "Switching governance tabs unmounts the inactive content" */
  it("unmounts the catalog content when switching to Sources", async () => {
    renderInventoryAt({ permissions: VIEWER_PERMISSIONS });
    const content = screen.getByRole("tabpanel").firstElementChild;
    expect(content).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^Sources/ }));
    await waitFor(() => expect(content).not.toBeInTheDocument());
  });

  describe("when an admin opens the bare address", () => {
    /** @scenario "The inventory default tab stays out of the address" */
    it("selects Catalog, mounts the tools catalog, and writes no tab parameter", () => {
      const host = renderInventoryAt({ permissions: CATALOG_ADMIN_PERMISSIONS });

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tool-catalog-empty")).toBeVisible();
      // Guards against re-mounting the retired tile editor on this pane.
      expect(screen.queryByRole("tab", { name: "Tool Tiles" })).toBeNull();
      expect(screen.queryByText("Tool Tiles")).not.toBeInTheDocument();
      expect(host.recording.queries).toEqual([]);
    });
  });

  describe("when an aiTools:manage admin addresses the Sources tab", () => {
    /** @scenario "The Sources tab is addressable" */
    it("selects Sources and mounts the table", () => {
      renderInventoryAt({ permissions: CATALOG_ADMIN_PERMISSIONS, query: { tab: "sources" } });

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
      const host = renderInventoryAt({ permissions: VIEWER_PERMISSIONS });

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
      expect(harness.requested).toContain("ingestionSources.list");
      expect(host.recording.queries).toEqual([]);
    });

    /** @scenario "The Sources tab is addressable" */
    it("can still reach Sources, which selects and writes the tab parameter", async () => {
      const host = renderInventoryAt({ permissions: VIEWER_PERMISSIONS });

      const sourcesTab = screen.getByRole("tab", { name: /^Sources/ });
      fireEvent.click(sourcesTab);

      await waitFor(() => expect(sourcesTab).toHaveAttribute("aria-selected", "true"));
      expect(host.recording.queries).toEqual([{ next: { tab: "sources" }, replace: true }]);
    });
  });

  describe("when the reader holds neither the registry nor the source grant", () => {
    /** @scenario "A reader without the registry grant meets the grant, not an empty catalog" */
    it("still selects Catalog, and names the grant instead of reporting no tools", () => {
      renderInventoryAt({ permissions: NO_SOURCES_READ_PERMISSIONS });

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText(/aiTools:manage/)).toBeVisible();
      expect(screen.queryByTestId("tool-catalog-empty")).toBeNull();
      expect(harness.requested).not.toContain("aiTools.adminList");
      expect(harness.requested).not.toContain("ingestionSources.list");
      // No count: a "0" would claim an empty organization this reader cannot see.
      expect(screen.getByRole("tab", { name: "Catalog" }).textContent).toBe("Catalog");
    });
  });

  describe("when an admin arrives on the retired anomaly-rules tab value", () => {
    /** @scenario "The retired anomaly-rules tab value lands on the catalog" */
    it("lists no Anomaly rules tab and falls back to the catalog", () => {
      renderInventoryAt({
        permissions: [...CATALOG_ADMIN_PERMISSIONS, "anomalyRules:view"],
        query: { tab: "anomaly-rules" },
      });

      expect(screen.queryByRole("tab", { name: /anomaly/i })).toBeNull();
      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tool-catalog-empty")).toBeInTheDocument();
    });
  });

  describe("when the address carries an add parameter for an offered type", () => {
    /** @scenario "An add parameter opens the composer on that source type and leaves the address" */
    it("opens the composer on that type and strips the parameter", async () => {
      const host = renderInventoryAt({
        permissions: SOURCES_ADMIN_PERMISSIONS,
        query: { tab: "sources", add: "claude_code" },
      });

      expect(await screen.findByRole("heading", { name: /Add Claude Code/ })).toBeVisible();
      await waitFor(() =>
        expect(host.recording.queries).toContainEqual({ next: { tab: "sources" }, replace: true }),
      );
    });
  });

  describe("when the address carries an add parameter for a plan-locked type", () => {
    /** @scenario "A locked add parameter is ignored and leaves the address" */
    it("opens nothing and still strips the parameter", async () => {
      const host = renderInventoryAt({
        permissions: SOURCES_ADMIN_PERMISSIONS,
        query: { tab: "sources", add: "claude_code" },
        isEnterprise: false,
      });

      await waitFor(() =>
        expect(host.recording.queries).toContainEqual({ next: { tab: "sources" }, replace: true }),
      );
      expect(screen.queryByRole("heading", { name: /Add Claude Code/ })).not.toBeInTheDocument();
    });
  });

  describe("when the address carries an unknown tab value", () => {
    /** @scenario "An unknown tab value falls back to the default" */
    it("selects the default and mounts the catalog instead of a blank pane", () => {
      renderInventoryAt({ permissions: CATALOG_ADMIN_PERMISSIONS, query: { tab: "nonsense" } });

      expect(screen.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tool-catalog-empty")).toBeVisible();
    });
  });
});
