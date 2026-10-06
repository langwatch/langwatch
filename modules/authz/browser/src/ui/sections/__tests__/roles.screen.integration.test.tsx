/**
 * @vitest-environment jsdom
 * Spec: specs/rbac/custom-role-permission-editing.feature
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MutationOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

const { api, state } = vi.hoisted(() => {
  const state = {
    roles: [] as Record<string, unknown>[],
    bindings: undefined as Record<string, unknown>[] | undefined,
    rolesLoading: false,
    createOptions: null as MutationOptions | null,
    updateOptions: null as MutationOptions | null,
    deleteOptions: null as MutationOptions | null,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    invalidate: vi.fn(),
    invalidateBindings: vi.fn(),
  };

  const api = {
    useUtils: () => ({
      role: { getAll: { invalidate: state.invalidate } },
      authz: { listManagedGrants: { invalidate: state.invalidateBindings } },
    }),
    authz: {
      listManagedGrants: {
        useQuery: () => ({ data: state.bindings, isLoading: false, isError: false }),
      },
    },
    role: {
      getAll: {
        useQuery: () => ({ data: state.roles, isLoading: state.rolesLoading, isError: false }),
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

// Isolation is off: reload so the screen binds this file's mock, not a sibling suite's.
vi.resetModules();
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../testing.tsx");
const { default: RolesScreen } = await import("../roles.screen.tsx");

const ANALYST_ROLE = {
  id: "role-1",
  organizationId: "org-1",
  name: "Data Analyst",
  description: "Reads, never writes",
  permissions: ["traces:view", "analytics:view"],
  kind: "custom",
  createdAt: "2026-03-12T12:00:00.000Z",
};

beforeEach(() => {
  state.roles = [];
  state.bindings = [];
  state.rolesLoading = false;
  state.create.mockReset();
  state.update.mockReset();
  state.remove.mockReset();
  state.invalidate.mockReset();
  state.invalidateBindings.mockReset();
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
    it("explains the feature is Enterprise and offers sales", async () => {
      renderWithAuthzHost(
        <RolesScreen />,
        new FakeAuthzHost({ plan: { isEnterprise: false, isLoading: false } }),
      );

      expect(screen.getByText("Enterprise Feature")).toBeInTheDocument();
      expect(await screen.findByTestId("contact-sales-block")).toBeInTheDocument();
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

      expect(screen.getByText("No custom roles yet")).toBeVisible();
      expect(screen.getByText(/^Write one when somebody needs/)).toBeVisible();
    });

    it("counts each custom role's permissions", () => {
      state.roles = [ANALYST_ROLE];
      renderWithAuthzHost(<RolesScreen />);

      expect(screen.getByText("Data Analyst")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "See all 2 permissions" })).toBeInTheDocument();
    });

    /** @scenario A built-in role's permissions come from the authorization contract */
    it("shows what a built-in role can do", async () => {
      renderWithAuthzHost(<RolesScreen />);

      fireEvent.click(
        within(screen.getByTestId("builtin-role-viewer")).getByRole("button", {
          name: "See what it can do",
        }),
      );

      expect(await screen.findByText("View traces")).toBeInTheDocument();
      // The viewer reads, so its lines are views and never full access.
      expect(screen.queryByText(/^Full access to/)).not.toBeInTheDocument();
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

      await userEvent.click(screen.getByRole("button", { name: /New role/ }));
      await userEvent.type(await screen.findByRole("textbox", { name: /Name/ }), "Auditor");
      await userEvent.click(screen.getByTestId("permission-area-Data and analysis"));
      await userEvent.click(within(screen.getByTestId("access-level-traces")).getByText("Read"));
      await userEvent.click(screen.getByRole("button", { name: "Create role" }));

      await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
      expect(state.create.mock.calls[0]?.[0]).toEqual({
        organizationId: "org-1",
        name: "Auditor",
        description: "",
        permissions: ["traces:view"],
      });
    });

    /** @scenario A refused write is reported to the reader, not swallowed */
    /** @scenario "A refusal reaches the reader as the error the server sent" */
    it("hands a refusal to the host with the raw error", () => {
      const { host } = renderWithAuthzHost(<RolesScreen />);
      const refusal = new Error("validation_error");

      state.createOptions?.onError?.(refusal);

      expect(host.failures).toEqual([
        { error: refusal, fallbackTitle: "Couldn't create this role" },
      ]);
      expect(host.successes).toEqual([]);
    });

    it("confirms a create and refreshes the roles and who holds them", () => {
      const { host } = renderWithAuthzHost(<RolesScreen />);

      state.createOptions?.onSuccess?.();

      expect(state.invalidate).toHaveBeenCalledTimes(1);
      expect(state.invalidateBindings).toHaveBeenCalledTimes(1);
      expect(host.successes).toEqual([{ title: "Role created" }]);
    });

    /** @scenario Deleting a custom role is confirmed first */
    it("asks before deleting, then deletes the role that was named", async () => {
      state.roles = [ANALYST_ROLE];
      renderWithAuthzHost(<RolesScreen />);

      fireEvent.click(screen.getByRole("button", { name: "Delete this role" }));

      expect(
        await screen.findByText(
          'Everyone holding "Data Analyst" loses what it grants them. This cannot be undone.',
        ),
      ).toBeInTheDocument();
      expect(state.remove).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      expect(state.remove.mock.calls[0]?.[0]).toEqual({ roleId: "role-1" });
    });
  });
});
