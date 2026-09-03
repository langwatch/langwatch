// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment jsdom
 *
 * The inventory page is a tabbed shell whose selected tab is part of the
 * address (?tab=), with a permission-sensitive default: Catalog (the
 * tool-tiles editor) for admins holding aiTools:manage, Sources for
 * everyone else. These tests mount the real page over a host that holds a
 * live query string — the tab value is read back out of the address the
 * host reports, so the assertions run against the same address the user
 * sees: the default is never written to it, and an unknown value degrades
 * to the default instead of a blank pane.
 *
 * Only the boundaries are mocked, and there is now one of them: the tRPC
 * client. The layout chrome, the feature flag, the plan and the address all
 * come from the governance host, which is a test double rather than a mocked
 * module. The tab selection and what mounts inside each pane are the real
 * page's doing.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeGovernanceHost,
  renderWithGovernanceHost,
  type GovernanceQuery,
} from "../../../testing";

const harness = vi.hoisted(() => ({
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
}));

/** The org-member floor plus the governance product grant and sources read. */
const VIEWER_PERMISSIONS = ["organization:view", "governance:view", "ingestionSources:view"];

/** The viewer set plus the catalog's own grant. */
const CATALOG_ADMIN_PERMISSIONS = [...VIEWER_PERMISSIONS, "aiTools:manage"];

vi.mock("../../../behavior/governance-api", () => {
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

import InventoryPage from "../governance-inventory.screen";

function renderInventoryAt({
  permissions,
  query = {},
}: {
  permissions: readonly string[];
  query?: GovernanceQuery;
}) {
  const host = fakeGovernanceHost({ permissions, query });
  renderWithGovernanceHost(<InventoryPage />, { host });
  return host;
}

beforeEach(() => {
  harness.requested = [];
});

afterEach(() => cleanup());

describe("the inventory tab shell", () => {
  describe("when an aiTools:manage admin opens the bare address", () => {
    /** @scenario "The inventory default tab stays out of the address" */
    it("selects Catalog, mounts the tool-tiles editor, and writes no tab parameter", () => {
      const host = renderInventoryAt({ permissions: CATALOG_ADMIN_PERMISSIONS });

      expect(screen.getByRole("tab", { name: "Catalog" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      // The editor body carries its own inner tab strip, unchanged from
      // the retired tool-catalog page.
      expect(screen.getByRole("tab", { name: "Tool Tiles" })).toBeTruthy();
      expect(host.recording.queries).toEqual([]);
    });
  });

  describe("when an aiTools:manage admin addresses the Sources tab", () => {
    /** @scenario "The Sources tab is addressable" */
    it("selects Sources and mounts the table", () => {
      renderInventoryAt({
        permissions: CATALOG_ADMIN_PERMISSIONS,
        query: { tab: "sources" },
      });

      expect(screen.getByRole("tab", { name: "Sources" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(harness.requested).toContain("ingestionSources.list");
    });
  });

  describe("when a delegated viewer opens the bare address", () => {
    /** @scenario "A delegated viewer without aiTools:manage defaults to Sources" */
    it("selects Sources, mounts the table, and writes no tab parameter", () => {
      const host = renderInventoryAt({ permissions: VIEWER_PERMISSIONS });

      expect(screen.getByRole("tab", { name: "Sources" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(harness.requested).toContain("ingestionSources.list");
      expect(host.recording.queries).toEqual([]);
    });

    /** @scenario "A delegated viewer without aiTools:manage defaults to Sources" */
    it("still lists the Catalog tab, which shows the permission notice in-pane", async () => {
      const host = renderInventoryAt({ permissions: VIEWER_PERMISSIONS });

      const catalogTab = screen.getByRole("tab", { name: "Catalog" });
      fireEvent.click(catalogTab);

      // Selection round-trips through the address (?tab=catalog), and the
      // pane mounts a tick after the trigger's aria state flips.
      await waitFor(() => expect(catalogTab.getAttribute("aria-selected")).toBe("true"));
      expect(host.recording.queries).toEqual([{ next: { tab: "catalog" }, replace: true }]);
      expect(await screen.findByText(/aiTools:manage/)).toBeTruthy();
    });
  });

  describe("when the address carries an unknown tab value", () => {
    /** @scenario "An unknown tab value falls back to the default" */
    it("selects the admin default and mounts the editor instead of a blank pane", () => {
      renderInventoryAt({
        permissions: CATALOG_ADMIN_PERMISSIONS,
        query: { tab: "nonsense" },
      });

      expect(screen.getByRole("tab", { name: "Catalog" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByRole("tab", { name: "Tool Tiles" })).toBeTruthy();
    });
  });
});
