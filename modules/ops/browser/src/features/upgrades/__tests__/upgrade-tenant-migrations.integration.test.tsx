/**
 * @vitest-environment jsdom
 * The Tenant migrations tab: one table of steps, a short intro, badges only for held or parked.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const LONG_TITLE = "T".repeat(300);

const MIGRATIONS = [
  {
    name: "ops:long-step",
    title: LONG_TITLE,
    description: "d",
    requiresOperatorConfirmation: false,
    availableOnThisInstallation: true,
    enrolledAutomatically: true,
    counts: { finalized: 4, migrated: 0, parked: 2, rolled_back: 0 },
    enrollment: null,
    attention: [],
  },
];

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    ops: {
      upgrade: {
        listSystemMigrations: { useQuery: () => ({ data: MIGRATIONS, isLoading: false }) },
        listMigrationEnrollments: {
          useQuery: () => ({ data: { isSaaS: false, enrollments: [] } }),
        },
        runSystemMigrationPass: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        enrollMigrationTenant: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        enrollMigrationCohort: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        runSystemMigrationForOrganization: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        rollBackSystemMigrationTenant: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        withdrawMigrationTenant: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}));
vi.mock("../../../behavior/ops-feedback.ts", () => ({
  useOpsToaster: () => ({ create: vi.fn() }),
  useShowErrorToast: () => vi.fn(),
}));
vi.mock("../../../behavior/ops-session.ts", () => ({
  useOpsPermission: () => ({ scope: { kind: "platform" } }),
}));

import { UpgradeTenantMigrations } from "../ui/sections/upgrade-tenant-migrations.tsx";

afterEach(cleanup);

describe("UpgradeTenantMigrations", () => {
  describe("given a step with a 300-character title and two parked organizations", () => {
    it("names the title in full on hover and badges only the non-zero parked count", () => {
      render(
        <DesignSystemProvider forcedTheme="light">
          <UpgradeTenantMigrations />
        </DesignSystemProvider>,
      );

      const row = screen.getByTestId("upgrade-tenant-migration-ops:long-step");
      expect(within(row).getByTitle(LONG_TITLE)).toBeTruthy();
      expect(row.querySelectorAll("[class*='badge']").length).toBe(1);
      expect(screen.getByTestId("upgrade-tenant-migrations-table")).toBeTruthy();
    });
  });
});
