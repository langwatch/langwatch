/**
 * @vitest-environment jsdom
 *
 * What a role can do, and who holds one: the rows, the routed drawer and the controls.
 * Spec: specs/identity/org-access-cluster.feature
 */
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api, state } = vi.hoisted(() => {
  const state = {
    roles: [] as unknown[],
    rolesError: null as unknown,
    assignments: [] as unknown[],
    assignmentsError: null as unknown,
  };
  const mutation = () => ({ mutate: () => void 0, mutateAsync: () => void 0, isPending: false });
  const api = {
    useUtils: () => ({
      role: { getAll: { invalidate: () => void 0 } },
      authz: { listManagedGrants: { invalidate: () => void 0 } },
    }),
    role: {
      getAll: {
        useQuery: () => ({
          data: state.rolesError ? undefined : state.roles,
          isLoading: false,
          isError: !!state.rolesError,
          error: state.rolesError,
        }),
      },
      create: { useMutation: mutation },
      update: { useMutation: mutation },
      delete: { useMutation: mutation },
    },
    authz: {
      listBillingMembers: {
        useQuery: () => ({ data: [{ userId: "user_pay" }], isLoading: false, isError: false }),
      },
      listManagedGrants: {
        useQuery: () => ({
          data: state.assignmentsError ? undefined : state.assignments,
          isLoading: false,
          isError: !!state.assignmentsError,
          error: state.assignmentsError,
        }),
      },
    },
  };
  return { api, state };
});

vi.mock("../../../behavior/authz-api.ts", () => ({ authzApi: api }));

// Isolation is off: reload so the panel binds this file's mock, not a sibling suite's.
vi.resetModules();
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../testing.tsx");
const { RolesPanel } = await import("../roles-panel.tsx");
const { RoleDetailDrawer } = await import("../role-detail-drawer.tsx");

function renderPanel({ canManage = true, canReadAuditLog = true } = {}) {
  return renderWithAuthzHost(
    <RolesPanel
      organizationId="org_acme"
      canManage={canManage}
      canReadAuditLog={canReadAuditLog}
    />,
    new FakeAuthzHost({ scope: { organizationId: "org_acme" } }),
  );
}

function renderDrawer(role: string) {
  return renderWithAuthzHost(
    <RoleDetailDrawer role={role} />,
    new FakeAuthzHost({ scope: { organizationId: "org_acme" } }),
  );
}

const supportAnalyst = {
  id: "role_1",
  organizationId: "org_acme",
  name: "Support analyst",
  description: "Reads customer conversations while handling a ticket.",
  permissions: ["traces:view", "annotations:view"],
  kind: "custom",
  createdAt: "2026-03-12T12:00:00.000Z",
  updatedAt: "2026-03-12T12:00:00.000Z",
};

const adminBinding = {
  id: "rb_admin",
  userId: "user_ana",
  userName: "Ana Diaz",
  userEmail: "ana@acme.com",
  userImage: null,
  groupId: null,
  groupName: null,
  groupScimSource: null,
  apiKeyId: null,
  apiKeyName: null,
  role: "ADMIN",
  customRoleId: null,
  customRoleName: null,
  scopeType: "ORGANIZATION",
  scopeId: "org_acme",
  scopeName: "Acme",
  memberUserIds: [],
  createdAt: "2026-01-01T00:00:00Z",
};

const customBinding = {
  ...adminBinding,
  id: "rb_custom",
  role: "CUSTOM",
  customRoleId: "role_1",
  customRoleName: "Support analyst",
  scopeType: "PROJECT",
  scopeId: "proj_1",
  scopeName: "support-copilot",
};

describe("given the roles of an organization", () => {
  beforeEach(() => {
    state.roles = [];
    state.rolesError = null;
    state.assignments = [];
    state.assignmentsError = null;
  });
  afterEach(() => cleanup());

  describe("when the built-in roles are drawn", () => {
    /** @scenario A predefined role row describes the role it actually is */
    it("draws one line per role in one list, Billing last", () => {
      renderPanel();

      const list = screen.getByTestId("builtin-roles");
      const lines = ["admin", "member", "viewer", "billing"].map((key) =>
        within(list).getByTestId(`builtin-role-${key}`),
      );
      expect(
        Array.from(list.querySelectorAll("[data-testid^='builtin-role-']")).map((line) =>
          line.getAttribute("data-testid"),
        ),
      ).toEqual([
        "builtin-role-admin",
        "builtin-role-member",
        "builtin-role-viewer",
        "builtin-role-billing",
      ]);
      expect(within(lines[0]!).getByText("Admin")).toBeInTheDocument();
      expect(within(lines[0]!).getByText(/plus teams, projects and model providers/)).toBeVisible();
      expect(within(lines[2]!).getByText(/changes none of it/)).toBeVisible();
    });

    /** @scenario A predefined role row describes the role it actually is */
    it("says how many permissions each role holds", () => {
      renderPanel();

      const viewer = within(screen.getByTestId("builtin-role-viewer"));
      expect(viewer.getByText(/^\d+ permissions$/)).toBeInTheDocument();
    });

    /** @scenario A predefined role row counts the people who hold it */
    it("counts the people holding it, including through a group", () => {
      state.assignments = [
        adminBinding,
        {
          ...adminBinding,
          id: "rb_group",
          userId: null,
          userName: null,
          userEmail: null,
          groupId: "grp_1",
          groupName: "Platform",
          memberUserIds: ["user_ana", "user_sam"],
        },
      ];
      renderPanel();

      expect(within(screen.getByTestId("builtin-role-admin")).getByText("2 people")).toBeVisible();
    });

    /** @scenario A predefined role row counts the people who hold it */
    it("says the count could not be read rather than showing a zero", () => {
      state.assignmentsError = new Error("boom");
      renderPanel();

      expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
      const admin = within(screen.getByTestId("builtin-role-admin"));
      expect(admin.getByText("Unavailable")).toBeInTheDocument();
      expect(admin.queryByText("0 people")).toBeNull();
    });
  });

  describe("when Billing is drawn", () => {
    /** @scenario Billing is the last line of the built-in roles and reads like the others */
    it("reads like the other roles, with no seat subheading or chip", () => {
      renderPanel();

      const billing = within(screen.getByTestId("builtin-role-billing"));
      expect(billing.getByText("Billing")).toBeInTheDocument();
      expect(billing.getByText("Pays: plan, seats, invoices and seat requests.")).toBeVisible();
      expect(billing.getByText("1 person")).toBeInTheDocument();
      expect(screen.queryByText(/Held beside/)).toBeNull();
      expect(screen.queryByText(/takes no seat/i)).toBeNull();
    });

    /** @scenario Billing is the last line of the built-in roles and reads like the others */
    it("keeps seats out of its drawer too", () => {
      renderDrawer("billing");

      const drawer = within(screen.getByRole("dialog"));
      expect(drawer.getByText("Pays: plan, seats, invoices and seat requests.")).toBeVisible();
      expect(drawer.queryByText(/Held beside/)).toBeNull();
      expect(drawer.queryByText(/takes no seat/i)).toBeNull();
    });
  });

  describe("when the reader asks what a built-in role can do", () => {
    /** @scenario A role's drawer says what the role can do */
    it("opens the routed role drawer on the address, not a dialog of its own", async () => {
      const { host } = renderPanel();

      await userEvent.click(
        within(screen.getByTestId("builtin-role-member")).getByRole("button", {
          name: "See what it can do",
        }),
      );

      expect(host.overlays).toEqual([{ drawer: "roleDetail", props: { role: "member" } }]);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    /** @scenario A role's drawer says what the role can do */
    it("holds the description, the headline permissions and the total", () => {
      renderDrawer("admin");

      const drawer = within(screen.getByRole("dialog", { name: "Admin" }));
      expect(drawer.getByText(/plus teams, projects and model providers/)).toBeVisible();
      expect(drawer.getByText("Everything Member has, and")).toBeVisible();
      expect(drawer.getByText(/^\d+ permissions in total$/)).toBeVisible();
      const chips = drawer.getAllByTestId("permission-token").map((chip) => chip.textContent);
      expect(chips).toContain("Full access to teams");
    });

    /** @scenario Every permission a role holds can be read in full */
    it("lists every permission, grouped by area, with its identifier", () => {
      renderDrawer("viewer");

      const areas = within(screen.getByTestId("role-permission-areas"));
      expect(areas.getByText(/permissions across \d+ areas\./)).toBeInTheDocument();
      expect(areas.getAllByText("View traces").length).toBeGreaterThan(0);
      expect(areas.queryByText(/^Full access to/)).toBeNull();
    });
  });

  describe("when a custom role has been written", () => {
    beforeEach(() => {
      state.roles = [supportAnalyst];
      state.assignments = [customBinding];
    });

    /** @scenario A custom role's drawer names who holds it and where */
    it("draws it as a line in the same row style", () => {
      renderPanel();

      const line = within(screen.getByTestId("custom-role-role_1"));
      expect(line.getByText("Support analyst")).toBeInTheDocument();
      expect(line.getByText(/Reads customer conversations/)).toBeInTheDocument();
      expect(line.getByText("1 person")).toBeInTheDocument();
      expect(line.getByText("2 permissions")).toBeInTheDocument();
    });

    /** @scenario A custom role's drawer names who holds it and where */
    it("names it, dates it, the scope it is in force on and who holds it", () => {
      renderDrawer("role_1");

      const drawer = within(screen.getByRole("dialog", { name: "Support analyst" }));
      expect(drawer.getByText("1 person")).toBeVisible();
      expect(drawer.getByText("Created 12 Mar 2026")).toBeInTheDocument();
      expect(drawer.getByText("support-copilot")).toBeInTheDocument();
      expect(drawer.getByText("Ana Diaz")).toBeInTheDocument();
    });

    /** @scenario A custom role's drawer names who holds it and where */
    it("says a group grant came through the group", () => {
      state.assignments = [
        {
          ...customBinding,
          id: "rb_custom_group",
          userId: null,
          userName: null,
          userEmail: null,
          groupId: "grp_1",
          groupName: "Support Engineers",
          groupScimSource: "entra",
          memberUserIds: ["user_sam"],
        },
      ];
      renderDrawer("role_1");

      const drawer = within(screen.getByRole("dialog"));
      expect(drawer.getByText("via Support Engineers")).toBeInTheDocument();
      expect(drawer.getByText("Directory")).toBeInTheDocument();
    });

    /** @scenario A custom role's drawer names who holds it and where */
    it("says plainly when nobody holds it", () => {
      state.assignments = [];
      renderDrawer("role_1");

      const drawer = within(screen.getByRole("dialog"));
      expect(drawer.getByText("Nobody yet.")).toBeInTheDocument();
      expect(drawer.getByText(/grants nothing until/)).toBeInTheDocument();
    });
  });

  describe("when the reader may manage the organization", () => {
    /** @scenario Only a reader who may manage the organization writes roles */
    it("offers New role and Edit on each custom role", () => {
      state.roles = [supportAnalyst];
      renderPanel();

      expect(screen.getByRole("button", { name: /New role/ })).toBeInTheDocument();
      expect(
        within(screen.getByTestId("custom-role-role_1")).getByRole("button", { name: "Edit" }),
      ).toBeInTheDocument();
    });
  });

  describe("when the reader may only view members", () => {
    /** @scenario Only a reader who may manage the organization writes roles */
    it("offers nothing that would change a role, and opens the drawer instead", async () => {
      state.roles = [supportAnalyst];
      const { host } = renderPanel({ canManage: false });

      expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /New role/ })).toBeNull();
      expect(screen.getAllByRole("button", { name: "See what it can do" })).toHaveLength(5);

      await userEvent.click(
        within(screen.getByTestId("custom-role-role_1")).getByRole("button", {
          name: "See what it can do",
        }),
      );
      expect(host.overlays).toEqual([{ drawer: "roleDetail", props: { role: "role_1" } }]);
    });
  });

  describe("when the roles cannot be read", () => {
    /** @scenario Reading the roles does not depend on a second answer */
    /** @scenario Custom roles that cannot be read report the failure */
    it("says what failed rather than showing an empty section", () => {
      state.rolesError = new Error("boom");
      renderPanel();

      expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
      expect(screen.getByText("Couldn't load your custom roles")).toBeInTheDocument();
      expect(screen.getByTestId("builtin-role-admin")).toBeInTheDocument();
    });
  });

  describe("when the reader can open the audit log", () => {
    /** @scenario Role changes are tied to the audit log that records them */
    it("points at the record of what was changed", () => {
      renderPanel();

      const link = screen.getByRole("link", { name: "audit log" });
      expect(link).toHaveAttribute("href", "/settings/audit-log");
    });

    /** @scenario Role changes are tied to the audit log that records them */
    it("stays quiet for a reader who cannot open it", () => {
      renderPanel({ canReadAuditLog: false });

      expect(screen.queryByRole("link", { name: "audit log" })).toBeNull();
    });
  });
});
