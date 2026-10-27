/**
 * @vitest-environment jsdom
 * The Organizations tab: one table of steps, a short intro, badges only for held or parked.
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
    tenant: "organization",
    migratedIsSteady: false,
    waitingOnPerson: 0,
    counts: { finalized: 4, migrated: 0, parked: 2, rolled_back: 0 },
    enrollment: null,
    attention: [],
  },
];
let isSaaS = false;
let ENROLLMENTS: Record<string, unknown>[] = [];

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    ops: {
      upgrade: {
        listSystemMigrations: { useQuery: () => ({ data: MIGRATIONS, isLoading: false }) },
        listTenants: { useInfiniteQuery: () => ({ data: { pages: [] }, isLoading: false }) },
        listMigrationEnrollments: {
          useQuery: () => ({ data: { isSaaS, enrollments: ENROLLMENTS } }),
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
  useIsSharedInstall: () => isSaaS,
}));

import { UpgradeTenantMigrations } from "../ui/sections/upgrade-tenant-migrations.tsx";

const ENROLLED = {
  organizationId: "org-1",
  organizationName: "Enrolled org",
  migrationName: "ops:manual",
  enrolledByLabel: "Operator",
  enrolledByUserId: "user-1",
  createdAt: 0,
};

afterEach(() => {
  cleanup();
  ENROLLMENTS = [];
});

function renderTab() {
  render(
    <DesignSystemProvider forcedTheme="light">
      <UpgradeTenantMigrations />
    </DesignSystemProvider>,
  );
}

describe("UpgradeTenantMigrations", () => {
  describe("given a step with a 300-character title and two parked organizations", () => {
    /** @scenario "Each organization step shows its organizations' progress on the Organizations tab" */
    it("names the title in full on hover and badges only the non-zero parked count", () => {
      MIGRATIONS = LONG_STEP;
      isSaaS = false;
      renderTab();

      const row = screen.getByTestId("upgrade-tenant-migration-ops:long-step");
      expect(within(row).getByTitle(LONG_TITLE)).toBeTruthy();
      expect(row.querySelectorAll("[class*='badge']").length).toBe(1);
      const cells = within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
      expect(cells.slice(1, 4)).toEqual(["4", "0", "2"]);
      expect(screen.getByTestId("upgrade-tenant-migrations-table")).toBeTruthy();
    });
  });

  describe("given an automatic step with one held organization and no enrolment rows", () => {
    /** @scenario "An automatic step reads every organization as enrolled" */
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

  describe("given a step whose migrated is its steady state, with 3 users kept in step and 1 parked", () => {
    /** @scenario "A step that never finalizes by design keeps its users in step, not held" */
    it("reads the count as kept in step, unbadged, and lists only the parked user", () => {
      MIGRATIONS = [
        {
          ...LONG_STEP[0],
          name: "identity-d01-secret-heal",
          title: "Sign-in credential repair",
          tenant: "user",
          migratedIsSteady: true,
          counts: { finalized: 0, migrated: 3, parked: 1, rolled_back: 0 },
          attention: [
            {
              migrationName: "identity-d01-secret-heal",
              tenantId: "user-9",
              organizationName: null,
              status: "parked",
              attempts: 1,
              updatedAt: 0,
              report: null,
            },
          ],
        },
      ];
      isSaaS = true;
      renderTab();

      const row = screen.getByTestId("upgrade-tenant-migration-identity-d01-secret-heal");
      expect(within(row).getByTestId("upgrade-kept-in-step").textContent).toBe("3 kept in step");
      // Only the parked count is badged; nobody reads as held.
      expect(row.querySelectorAll("[class*='badge']").length).toBe(1);
      expect(screen.getByText("Organization needing attention")).toBeTruthy();
      const attentionRow = screen.getByText("user-9").closest("tr");
      expect(attentionRow?.textContent).toContain("Parked");
    });
  });

  describe("given a step holding 2 users for their proof and 3 waiting to confirm their address", () => {
    /** @scenario "Users waiting on a person are counted, not listed as needing attention" */
    it("badges the 2 held and notes the 3 waiting on the person beneath", () => {
      MIGRATIONS = [
        {
          ...LONG_STEP[0],
          name: "identity:identifier-backfill",
          title: "Identifier history backfill",
          tenant: "user",
          waitingOnPerson: 3,
          counts: { finalized: 10, migrated: 5, parked: 0, rolled_back: 0 },
        },
      ];
      isSaaS = true;
      renderTab();

      const row = screen.getByTestId("upgrade-tenant-migration-identity:identifier-backfill");
      expect(within(row).getByTestId("upgrade-waiting-on-person").textContent).toBe(
        "3 waiting on the person",
      );
      const badges = row.querySelectorAll("[class*='badge']");
      expect([...badges].map((badge) => badge.textContent)).toEqual(["2"]);
    });
  });

  describe("given a self-hosted installation with a step not enrolled automatically", () => {
    /** @scenario "A self-hosted installation offers no enrolment on the Organizations tab" */
    it("offers run for an organization and roll back, and no enrolment", () => {
      MIGRATIONS = [{ ...LONG_STEP[0], name: "ops:manual", enrolledAutomatically: false }];
      ENROLLMENTS = [ENROLLED];
      isSaaS = false;
      renderTab();

      const row = screen.getByTestId("upgrade-tenant-migration-ops:manual");
      for (const name of [/Run for organization/, /Roll back/]) {
        expect(within(row).getByRole("button", { name })).toBeTruthy();
      }
      for (const name of [/^Enroll…/, /Enroll cohort/, /Withdraw/]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(screen.getByRole("button", { name: /Run a pass now/ })).toBeTruthy();
    });
  });

  describe("given the cloud installation with a step not enrolled automatically", () => {
    /** @scenario "Cloud offers enrolment beside every organization action" */
    it("offers enrol, enrol a cohort, run for an organization, roll back and withdraw", () => {
      MIGRATIONS = [{ ...LONG_STEP[0], name: "ops:manual", enrolledAutomatically: false }];
      ENROLLMENTS = [ENROLLED];
      isSaaS = true;
      renderTab();

      const row = screen.getByTestId("upgrade-tenant-migration-ops:manual");
      for (const name of [/^Enroll…/, /Enroll cohort/, /Run for organization/, /Roll back/]) {
        expect(within(row).getByRole("button", { name })).toBeTruthy();
      }
      expect(screen.getByRole("button", { name: /Withdraw/ })).toBeTruthy();
    });
  });
});
