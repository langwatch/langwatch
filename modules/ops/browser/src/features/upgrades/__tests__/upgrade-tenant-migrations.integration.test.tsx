/**
 * @vitest-environment jsdom
 * The Tenant migrations tab: one table of steps, a short intro, badges only for held or parked.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const LONG_TITLE = "T".repeat(300);

let MIGRATIONS: Record<string, unknown>[] = [];
const LONG_STEP = [
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
let isSaaS = false;

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    ops: {
      upgrade: {
        listSystemMigrations: { useQuery: () => ({ data: MIGRATIONS, isLoading: false }) },
        listMigrationEnrollments: {
          useQuery: () => ({ data: { isSaaS, enrollments: [] } }),
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

function renderTab() {
  render(
    <DesignSystemProvider forcedTheme="light">
      <UpgradeTenantMigrations />
    </DesignSystemProvider>,
  );
}

describe("UpgradeTenantMigrations", () => {
  describe("given a step with a 300-character title and two parked organizations", () => {
    it("names the title in full on hover and badges only the non-zero parked count", () => {
      MIGRATIONS = LONG_STEP;
      isSaaS = false;
      renderTab();

      const row = screen.getByTestId("upgrade-tenant-migration-ops:long-step");
      expect(within(row).getByTitle(LONG_TITLE)).toBeTruthy();
      expect(row.querySelectorAll("[class*='badge']").length).toBe(1);
      expect(screen.getByTestId("upgrade-tenant-migrations-table")).toBeTruthy();
    });
  });

  describe("given an automatic step on SaaS with one held organization and no enrolment rows", () => {
    it("reads Enrolled as All and lists the held organization without an empty enrolment table", () => {
      MIGRATIONS = [
        {
          ...LONG_STEP[0],
          name: "authz:engine",
          title: "Authorization engine",
          counts: { finalized: 0, migrated: 1, parked: 0, rolled_back: 0 },
          attention: [
            {
              migrationName: "authz:engine",
              tenantId: "org-1",
              organizationName: "Held org",
              status: "migrated",
              attempts: 1,
              updatedAt: 0,
              report: null,
            },
          ],
        },
      ];
      isSaaS = true;
      renderTab();

      const row = screen.getByTestId("upgrade-tenant-migration-authz:engine");
      expect(within(row).getByText("All")).toBeTruthy();
      expect(screen.queryByText("No organizations are enrolled for this step yet.")).toBeNull();
      expect(screen.getByText("Organization needing attention")).toBeTruthy();
    });
  });
});
