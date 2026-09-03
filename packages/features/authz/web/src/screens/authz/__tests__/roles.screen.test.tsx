/**
 * @vitest-environment jsdom
 *
 * Roles & Permissions, driven the way an organization administrator drives it.
 *
 * `platform/app/src/pages/settings/roles.tsx` had no test of its own — only the
 * source-reading guard that pinned which permission wrapped it — so these are
 * new, and they pin what the move could plausibly have broken: the three-state
 * plan gate, the grant on the write control, the built-in role permissions now
 * that they come from the contract rather than from `~/server/api/rbac`, and
 * the failure path handing the raw error to the host rather than composing a
 * sentence out of it.
 *
 * Spec: specs/rbac/custom-role-permission-editing.feature
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuthzHost, renderWithAuthzHost } from "../../../testing";

type MutationOptions = {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

const { api, state } = vi.hoisted(() => {
  const state = {
    roles: [] as Array<Record<string, unknown>>,
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

vi.mock("../../../behavior/authz-api", () => ({ authzApi: api }));

const { default: RolesScreen } = await import("../roles.screen");

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
      expect(screen.queryByText("Default Roles")).not.toBeInTheDocument();
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
      expect(screen.queryByText("Custom Roles")).not.toBeInTheDocument();
    });
  });

  describe("given an Enterprise organization", () => {
    /** @scenario The three built-in roles are listed beside the custom ones */
    it("lists the built-in roles", () => {
      renderWithAuthzHost(<RolesScreen />);

      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByText("Member")).toBeInTheDocument();
      expect(screen.getByText("Viewer")).toBeInTheDocument();
      expect(screen.getAllByText("Built-in Role")).toHaveLength(3);
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

      // A built-in card carries no action buttons — it cannot be edited or
      // deleted — so the card itself is what opens its permissions.
      fireEvent.click(screen.getByText("Read-only access to analytics, messages, and guardrails"));

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

      expect(screen.getByRole("button", { name: /Create Role/ })).toBeDisabled();
    });

    /** @scenario An administrator defines a custom role */
    it("files the new role against the organization in scope", async () => {
      renderWithAuthzHost(<RolesScreen />);

      fireEvent.click(screen.getByRole("button", { name: /Create Role/ }));

      const nameField = await screen.findByPlaceholderText("e.g., Data Analyst");
      fireEvent.change(nameField, { target: { value: "Auditor" } });

      const matrix = screen.getByText("auditLog", { selector: "p" }).closest("fieldset");
      fireEvent.click(within(matrix as HTMLElement).getByRole("checkbox"));

      // Two buttons read "Create Role" once the dialog is open — the header's
      // and the form's — and it is the form's that submits.
      const submit = screen
        .getAllByRole("button", { name: "Create Role" })
        .find((button) => button.getAttribute("form") === "role-form");
      fireEvent.click(submit!);

      await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
      expect(state.create.mock.calls[0]?.[0]).toEqual({
        organizationId: "org-1",
        name: "Auditor",
        description: "",
        permissions: ["auditLog:view"],
      });
    });

    /** @scenario A refused write is reported to the reader, not swallowed */
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
