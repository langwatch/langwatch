/**
 * @vitest-environment jsdom
 * Spec: specs/rbac/custom-role-permission-editing.feature
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAuthzHost, renderWithAuthzHost } from "../../../testing.tsx";

type MutationOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

const { api, state } = vi.hoisted(() => {
  const state = {
    roles: [] as Record<string, unknown>[],
    bindings: undefined as Record<string, unknown>[] | undefined,
    rolesLoading: false,
    detail: null as Record<string, unknown> | null,
    detailError: null as unknown,
    createOptions: null as MutationOptions | null,
    updateOptions: null as MutationOptions | null,
    deleteOptions: null as MutationOptions | null,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    invalidate: vi.fn(),
  };

  const api = {
    useUtils: () => ({
      role: {
        getAll: { invalidate: state.invalidate },
        getById: {
          fetch: () =>
            state.detailError ? Promise.reject(state.detailError) : Promise.resolve(state.detail),
        },
      },
    }),
    roleBinding: {
      listForOrg: { useQuery: () => ({ data: state.bindings }) },
    },
    role: {
      getAll: {
        useQuery: () => ({ data: state.roles, isLoading: state.rolesLoading }),
      },
      create: {
        useMutation: (options: MutationOptions) => {
          state.createOptions = options;
          return { mutateAsync: state.create, isPending: false };
        },
      },
      update: {
        useMutation: (options: MutationOptions) => {
          state.updateOptions = options;
          return { mutateAsync: state.update, isPending: false };
        },
      },
      delete: {
        useMutation: (options: MutationOptions) => {
          state.deleteOptions = options;
          return { mutate: state.remove, isPending: false };
        },
      },
    },
  };

  return { api, state };
});

vi.mock("../../../behavior/authz-api.ts", () => ({ authzApi: api }));

const { default: RolesScreen } = await import("../roles.screen.tsx");

const ANALYST_ROLE = {
  id: "role-1",
  organizationId: "org-1",
  name: "Data Analyst",
  description: "Reads, never writes",
  permissions: ["traces:view", "analytics:view"],
  kind: "custom",
};

beforeEach(() => {
  state.roles = [];
  state.bindings = [];
  state.rolesLoading = false;
  state.detail = null;
  state.detailError = null;
  state.create.mockReset();
  state.update.mockReset();
  state.remove.mockReset();
  state.invalidate.mockReset();
});

describe("the Roles screen", () => {
  describe("given the plan has not answered yet", () => {
    /** @scenario A plan still arriving shows neither the feature nor the pitch */
    it("shows neither the feature nor the sales block", () => {
      renderWithAuthzHost(
        <RolesScreen />,
        new FakeAuthzHost({ plan: { isEnterprise: false, isLoading: true } }),
      );

      expect(screen.queryByText("Enterprise Feature")).not.toBeInTheDocument();
      expect(screen.queryByText("Predefined roles")).not.toBeInTheDocument();
    });
  });

  describe("given the organization is not on Enterprise", () => {
    /** @scenario Custom roles are an Enterprise feature */
    it("explains the feature is Enterprise and offers sales", () => {
      renderWithAuthzHost(
        <RolesScreen />,
        new FakeAuthzHost({ plan: { isEnterprise: false, isLoading: false } }),
      );

      expect(screen.getByText("Enterprise Feature")).toBeInTheDocument();
      expect(screen.getByTestId("contact-sales-block")).toBeInTheDocument();
      expect(screen.queryByText("Custom roles")).not.toBeInTheDocument();
    });
  });

  describe("given an Enterprise organization", () => {
    /** @scenario The three built-in roles are listed beside the custom ones */
    it("lists the built-in roles", () => {
      renderWithAuthzHost(<RolesScreen />);

      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByText("Member")).toBeInTheDocument();
      expect(screen.getByText("Viewer")).toBeInTheDocument();
      expect(screen.getByText("Predefined roles")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "See what it can do" })).toHaveLength(3);
    });

    /** @scenario The three built-in roles are listed beside the custom ones */
    it("counts the people holding each built-in role, through a group too", () => {
      state.bindings = [
        { id: "b1", role: "ADMIN", customRoleId: null, userId: "u1", memberUserIds: [] },
        { id: "b2", role: "ADMIN", customRoleId: null, userId: null, memberUserIds: ["u1", "u2"] },
        { id: "b3", role: "VIEWER", customRoleId: "role-1", userId: "u3", memberUserIds: [] },
      ];
      renderWithAuthzHost(<RolesScreen />);

      expect(within(screen.getByTestId("builtin-role-admin")).getByText("2 people")).toBeVisible();
      expect(within(screen.getByTestId("builtin-role-viewer")).getByText("0 people")).toBeVisible();
    });

    it("shows a headline permission chip on each built-in card", () => {
      renderWithAuthzHost(<RolesScreen />);

      const chips = within(screen.getByTestId("builtin-role-viewer")).getAllByTestId(
        "permission-token",
      );
      expect(chips.map((chip) => chip.textContent)).toEqual([
        "traces:view",
        "analytics:view",
        "datasets:view",
      ]);
    });

    it("links to the audit log only for a reader who may read it", () => {
      const { unmount } = renderWithAuthzHost(<RolesScreen />);
      expect(screen.queryByRole("link", { name: "audit log" })).not.toBeInTheDocument();
      unmount();

      renderWithAuthzHost(
        <RolesScreen />,
        new FakeAuthzHost({ grants: new Set(["organization:manage", "auditLog:view"]) }),
      );
      expect(screen.getByRole("link", { name: "audit log" })).toHaveAttribute(
        "href",
        "/settings/audit-log",
      );
    });

    it("says so when no custom role has been defined", () => {
      renderWithAuthzHost(<RolesScreen />);

      expect(
        screen.getByText("No custom roles yet. Create your first custom role to get started."),
      ).toBeInTheDocument();
    });

    it("counts each custom role's permissions", () => {
      state.roles = [ANALYST_ROLE];
      renderWithAuthzHost(<RolesScreen />);

      expect(screen.getByText("Data Analyst")).toBeInTheDocument();
      expect(screen.getByText("2 permissions")).toBeInTheDocument();
    });

    /** @scenario A built-in role's permissions come from the authorization contract */
    it("shows what a built-in role can do", async () => {
      renderWithAuthzHost(<RolesScreen />);

      fireEvent.click(
        within(screen.getByTestId("builtin-role-viewer")).getByRole("button", {
          name: "See what it can do",
        }),
      );

      expect(await screen.findByText(/^View Permissions - Viewer$/)).toBeInTheDocument();
      // The viewer reads, so its rows are views and never a manage.
      expect(screen.getAllByText("View").length).toBeGreaterThan(0);
      expect(screen.queryByText("Manage (Create, Update, Delete)")).not.toBeInTheDocument();
    });

    /** @scenario A reader without the grant cannot create a role */
    it("disables the create control without organization:manage", () => {
      renderWithAuthzHost(
        <RolesScreen />,
        new FakeAuthzHost({ grants: new Set(["organization:view"]) }),
      );

      expect(screen.getByRole("button", { name: /New role/ })).toBeDisabled();
    });

    /** @scenario An administrator defines a custom role */
    it("files the new role against the organization in scope", async () => {
      renderWithAuthzHost(<RolesScreen />);

      fireEvent.click(screen.getByRole("button", { name: /New role/ }));

      const nameField = await screen.findByPlaceholderText("e.g., Data Analyst");
      fireEvent.change(nameField, { target: { value: "Auditor" } });

      const matrix = screen.getByText("auditLog", { selector: "p" }).closest("fieldset");
      fireEvent.click(within(matrix as HTMLElement).getByRole("checkbox"));

      fireEvent.click(screen.getByRole("button", { name: "Create Role" }));

      await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
      expect(state.create.mock.calls[0]?.[0]).toEqual({
        organizationId: "org-1",
        name: "Auditor",
        description: "",
        permissions: ["auditLog:view"],
      });
    });

    /** @scenario A refused write is reported to the reader, not swallowed */
    /** @scenario "A refusal reaches the reader as the error the server sent" */
    it("hands a refusal to the host with the raw error", () => {
      const { host } = renderWithAuthzHost(<RolesScreen />);
      const refusal = new Error("validation_error");

      state.createOptions?.onError?.(refusal);

      expect(host.failures).toEqual([{ error: refusal, fallbackTitle: "Couldn't create role" }]);
      expect(host.successes).toEqual([]);
    });

    it("confirms a create and refreshes the list", () => {
      const { host } = renderWithAuthzHost(<RolesScreen />);

      state.createOptions?.onSuccess?.();

      expect(state.invalidate).toHaveBeenCalledTimes(1);
      expect(host.successes).toEqual([{ title: "Role created successfully" }]);
    });

    /** @scenario Deleting a custom role is confirmed first */
    it("asks before deleting, then deletes the role that was named", async () => {
      state.roles = [ANALYST_ROLE];
      renderWithAuthzHost(<RolesScreen />);

      fireEvent.click(screen.getByRole("button", { name: "Delete Data Analyst" }));

      expect(await screen.findByText("Delete role")).toBeInTheDocument();
      expect(
        screen.getByText('Are you sure you want to delete the role "Data Analyst"?'),
      ).toBeInTheDocument();
      expect(state.remove).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      expect(state.remove.mock.calls[0]?.[0]).toEqual({ roleId: "role-1" });
    });

    /** @scenario A role whose details cannot be read reports the failure */
    it("reports a failed detail read rather than opening an empty editor", async () => {
      state.roles = [ANALYST_ROLE];
      state.detailError = new Error("not_found");
      const { host } = renderWithAuthzHost(<RolesScreen />);

      fireEvent.click(screen.getByRole("button", { name: "Edit Data Analyst" }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]?.fallbackTitle).toBe("Couldn't load role details");
      expect(screen.queryByText("Edit Role")).not.toBeInTheDocument();
    });
  });
});
