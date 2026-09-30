/**
 * @vitest-environment jsdom
 *
 * What a role can do, and who holds one (main's RolesPanel suite).
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
      roleBinding: { listForOrg: { invalidate: () => void 0 } },
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
    roleBinding: {
      listForOrg: {
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
const { renderWithAuthzHost } = await import("../../../testing.tsx");
const { RolesPanel } = await import("../roles-panel.tsx");

function renderPanel({ canManage = true, canReadAuditLog = true } = {}) {
  renderWithAuthzHost(
    <RolesPanel
      organizationId="org_acme"
      canManage={canManage}
      canReadAuditLog={canReadAuditLog}
    />,
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

describe("given the roles of an organization", () => {
  beforeEach(() => {
    state.roles = [];
    state.rolesError = null;
    state.assignments = [];
    state.assignmentsError = null;
  });
  afterEach(() => cleanup());

  describe("when the predefined roles are drawn", () => {
    /** @scenario A predefined role card describes the role it actually is */
    it("names each tier and says in plain words what it grants", () => {
      renderPanel();

      const admin = within(screen.getByTestId("builtin-role-admin"));
      expect(admin.getByText("Admin")).toBeInTheDocument();
      expect(admin.getByText(/who is on it/)).toBeInTheDocument();

      const viewer = within(screen.getByTestId("builtin-role-viewer"));
      expect(viewer.getByText(/change none of it/)).toBeInTheDocument();
    });

    /** @scenario A predefined role card describes the role it actually is */
    it("shows the permission tokens the role is made of", () => {
      renderPanel();

      const admin = within(screen.getByTestId("builtin-role-admin"));
      const tokens = admin.getAllByTestId("permission-token").map((token) => token.textContent);

      expect(tokens).toContain("team:manage");
      expect(tokens).toContain("project:delete");
    });

    /** @scenario A predefined role card counts the people who hold it */
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

      const admin = within(screen.getByTestId("builtin-role-admin"));
      expect(admin.getByText("2 people")).toBeInTheDocument();
    });

    /** @scenario A predefined role card counts the people who hold it */
    it("says the count could not be read rather than showing a zero", () => {
      state.assignmentsError = new Error("boom");
      renderPanel();

      expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
      const admin = within(screen.getByTestId("builtin-role-admin"));
      expect(admin.getByText("Holders unavailable")).toBeInTheDocument();
      expect(admin.queryByText("0 people")).toBeNull();
    });
  });

  describe("when a custom role has been written", () => {
    beforeEach(() => {
      state.roles = [supportAnalyst];
      state.assignments = [
        {
          ...adminBinding,
          id: "rb_custom",
          role: "CUSTOM",
          customRoleId: "role_1",
          customRoleName: "Support analyst",
          scopeType: "PROJECT",
          scopeId: "proj_1",
          scopeName: "support-copilot",
        },
      ];
    });

    /** @scenario A custom role card names who holds it and where */
    it("names it, dates it, and shows what it grants", () => {
      renderPanel();

      const card = within(screen.getByTestId("custom-role-role_1"));
      expect(card.getByText("Support analyst")).toBeInTheDocument();
      expect(card.getByText("Created 12 Mar 2026")).toBeInTheDocument();
      expect(card.getByText("traces")).toBeInTheDocument();
    });

    /** @scenario A custom role card names who holds it and where */
    it("names the scope it is in force on and the person holding it", () => {
      renderPanel();

      const card = within(screen.getByTestId("custom-role-role_1"));
      expect(card.getByText("support-copilot")).toBeInTheDocument();
      expect(card.getByText("Ana Diaz")).toBeInTheDocument();
    });

    /** @scenario A custom role card names who holds it and where */
    it("says a group grant came through the group", () => {
      state.assignments = [
        {
          ...adminBinding,
          id: "rb_custom_group",
          userId: null,
          userName: null,
          userEmail: null,
          groupId: "grp_1",
          groupName: "Support Engineers",
          groupScimSource: "entra",
          role: "CUSTOM",
          customRoleId: "role_1",
          customRoleName: "Support analyst",
          memberUserIds: ["user_sam"],
        },
      ];
      renderPanel();

      const card = within(screen.getByTestId("custom-role-role_1"));
      expect(card.getByText("via Support Engineers")).toBeInTheDocument();
      expect(card.getByText("Directory")).toBeInTheDocument();
    });

    /** @scenario A custom role card names who holds it and where */
    it("says plainly when nobody holds it", () => {
      state.assignments = [];
      renderPanel();

      const card = within(screen.getByTestId("custom-role-role_1"));
      expect(card.getByText("Nobody yet.")).toBeInTheDocument();
      expect(card.getByText(/grants nothing until/)).toBeInTheDocument();
    });

    /** @scenario Every permission a role holds can be read in full */
    it("opens the whole permission list on request", async () => {
      renderPanel();

      await userEvent.click(screen.getByRole("button", { name: /See all 2 permissions/ }));

      expect(await screen.findByText("2 permissions across 1 area.")).toBeInTheDocument();
      expect(screen.getByText("View traces")).toBeInTheDocument();
    });
  });

  describe("when the reader may not manage the organization", () => {
    /** @scenario A custom role card names who holds it and where */
    it("offers nothing that would change a role", () => {
      state.roles = [supportAnalyst];
      renderPanel({ canManage: false });

      expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
      expect(screen.getByRole("button", { name: /New role/ })).toBeDisabled();
    });
  });

  describe("when the roles cannot be read", () => {
    /** @scenario Reading the roles does not depend on a second answer */
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
