/** @vitest-environment jsdom */
// The Roles page's assignments tab: one read, grouping onto holders, the scope filter.

import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, state } = vi.hoisted(() => {
  const state = {
    bindings: [] as Record<string, unknown>[] | undefined,
    isLoading: false,
    lastQuery: null as { input: unknown; options: { enabled?: boolean } } | null,
  };

  const api = {
    roleBinding: {
      listForOrg: {
        useQuery: (input: unknown, options: { enabled?: boolean }) => {
          state.lastQuery = { input, options };
          return { data: state.bindings, isLoading: state.isLoading };
        },
      },
    },
  };

  return { api, state };
});

vi.mock("../../../behavior/authz-api.ts", () => ({ authzApi: api }));

// The pool shares a module graph across files: the panel and its host load fresh over this mock.
vi.resetModules();
const { renderWithAuthzHost } = await import("../../../testing.tsx");
const { RoleAssignmentsPanel } = await import("../role-assignments-panel.tsx");

const panel = <RoleAssignmentsPanel organizationId="org-1" />;

function binding(overrides: Record<string, unknown>) {
  return {
    id: "b1",
    userId: null,
    userName: null,
    userEmail: null,
    userImage: null,
    groupId: null,
    groupName: null,
    groupScimSource: null,
    apiKeyId: null,
    apiKeyName: null,
    role: "MEMBER",
    customRoleId: null,
    customRoleName: null,
    scopeType: "PROJECT",
    scopeId: "proj-1",
    scopeName: "Web App",
    memberUserIds: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  state.bindings = [];
  state.isLoading = false;
  state.lastQuery = null;
});

describe("the role assignments tab", () => {
  describe("given an Enterprise organization", () => {
    /** @scenario The audit reads every binding in the organization */
    it("asks for the organization in scope", () => {
      renderWithAuthzHost(panel);

      expect(state.lastQuery?.input).toEqual({ organizationId: "org-1" });
      expect(state.lastQuery?.options.enabled).toBe(true);
    });

    it("says so when nobody holds a role", () => {
      renderWithAuthzHost(panel);

      expect(screen.getByText("Nobody has been assigned a role yet.")).toBeInTheDocument();
      expect(screen.getByText("0 members and groups")).toBeInTheDocument();
    });

    /** @scenario Every binding a principal holds reads as one row */
    it("puts a member's bindings on one row", () => {
      state.bindings = [
        binding({ id: "b1", userId: "u1", userName: "Ada", userEmail: "ada@example.com" }),
        binding({
          id: "b2",
          userId: "u1",
          userName: "Ada",
          scopeType: "TEAM",
          scopeName: "Platform",
          role: "CUSTOM",
          customRoleName: "Auditor",
        }),
      ];
      renderWithAuthzHost(panel);

      expect(screen.getByText("1 member or group")).toBeInTheDocument();
      expect(screen.getAllByText("Ada")).toHaveLength(1);
      expect(screen.getByText("Project · Web App")).toBeInTheDocument();
      expect(screen.getByText("Team · Platform")).toBeInTheDocument();
      // A custom role is named by its own name, never by the tier it sits on.
      expect(screen.getByText("Auditor")).toBeInTheDocument();
    });

    it("labels a group binding by its directory source", () => {
      state.bindings = [
        binding({ id: "b1", groupId: "g1", groupName: "Engineering", groupScimSource: "okta" }),
      ];
      renderWithAuthzHost(panel);

      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText("OKTA")).toBeInTheDocument();
    });

    /** @scenario The scope filter narrows the audit to one tier */
    it("narrows to one tier and back", () => {
      state.bindings = [
        binding({ id: "b1", userId: "u1", userName: "Ada", scopeType: "ORGANIZATION" }),
        binding({ id: "b2", userId: "u2", userName: "Grace", scopeType: "TEAM" }),
      ];
      renderWithAuthzHost(panel);

      expect(screen.getByText("2 members and groups")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Team" }));

      expect(screen.getByText("1 member or group")).toBeInTheDocument();
      expect(screen.getByText("Grace")).toBeInTheDocument();
      expect(screen.queryByText("Ada")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "All" }));

      expect(screen.getByText("2 members and groups")).toBeInTheDocument();
    });

    it("shows a spinner rather than an empty audit while the read is in flight", () => {
      state.bindings = void 0;
      state.isLoading = true;
      renderWithAuthzHost(panel);

      expect(screen.queryByText("Nobody has been assigned a role yet.")).not.toBeInTheDocument();
    });
  });
});
