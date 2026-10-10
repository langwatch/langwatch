/**
 * @vitest-environment jsdom
 * The Tenant migrations tab's tenant list: rows by step and state, and a failed read named.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROWS = [
  {
    migrationName: "ops:first",
    tenantId: "org_held",
    status: "migrated",
    report: null,
    updatedAt: new Date("2026-10-09T10:00:00Z"),
  },
  {
    migrationName: "ops:second",
    tenantId: "org_done",
    status: "finalized",
    report: null,
    updatedAt: new Date("2026-10-09T09:00:00Z"),
  },
];

const listTenants = vi.fn();
let failure: Error | null = null;

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    ops: {
      upgrade: {
        listTenants: {
          useInfiniteQuery: (input: { step?: string; state?: string }) => {
            listTenants(input);
            if (failure) return { error: failure, isLoading: false };
            const items = ROWS.filter(
              (row) =>
                (!input.step || row.migrationName === input.step) &&
                (!input.state || row.status === input.state),
            );
            return { data: { pages: [{ items, cursor: null }] }, isLoading: false };
          },
        },
      },
    },
  },
}));

import { UpgradeTenantList } from "../ui/sections/upgrade-tenant-list.tsx";

afterEach(() => {
  cleanup();
  failure = null;
  listTenants.mockClear();
});

function renderList() {
  render(
    <DesignSystemProvider forcedTheme="light">
      <UpgradeTenantList
        steps={[
          { name: "ops:first", title: "First step" },
          { name: "ops:second", title: "Second step" },
        ]}
      />
    </DesignSystemProvider>,
  );
}

describe("UpgradeTenantList", () => {
  describe("given a held organization in one step and a finalized one in another", () => {
    /** @scenario "The Tenant migrations tab lists every tenant's state, filtered by step and state" */
    it("lists only the held organization, with its step and state, once filtered to held", () => {
      renderList();
      expect(screen.getByTestId("upgrade-tenant-org_done")).toBeTruthy();

      fireEvent.change(screen.getByLabelText("State"), { target: { value: "migrated" } });

      expect(listTenants).toHaveBeenLastCalledWith(expect.objectContaining({ state: "migrated" }));
      expect(screen.queryByTestId("upgrade-tenant-org_done")).toBeNull();
      const row = screen.getByTestId("upgrade-tenant-org_held");
      expect(within(row).getByText("First step")).toBeTruthy();
      expect(within(row).getByText("Held")).toBeTruthy();
    });
  });

  describe("given the tenant read fails", () => {
    /** @scenario "The tenant list names a failed read instead of showing an empty list" */
    it("shows the failure and no empty-state copy", () => {
      failure = new Error("boom");
      renderList();

      expect(screen.getByText("Couldn't load the tenants")).toBeTruthy();
      expect(screen.queryByText("No tenant has a recorded state here yet.")).toBeNull();
    });
  });
});
