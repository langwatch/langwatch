/**
 * @vitest-environment jsdom
 *
 * Role Bindings, driven the way an administrator reads an access audit.
 *
 * `platform/app/src/pages/settings/role-bindings.tsx` had no test of its own,
 * so these are new. They pin the plan gate, the read that only fires once there
 * is an organization AND the plan admits the feature, the grouping a reader
 * sees, and the four-button scope filter.
 *
 * Spec: specs/rbac/role-binding-audit.feature
 */

import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuthzHost, renderWithAuthzHost } from "../../../testing";

const { api, state } = vi.hoisted(() => {
  const state = {
    bindings: [] as Array<Record<string, unknown>> | undefined,
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

vi.mock("../../../behavior/authz-api", () => ({ authzApi: api }));

const { default: RoleBindingsScreen } = await import("../role-bindings.screen");

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

describe("the Role Bindings screen", () => {
  describe("given the plan has not answered yet", () => {
    it("shows neither the audit nor the pitch", () => {
      renderWithAuthzHost(
        <RoleBindingsScreen />,
        new FakeAuthzHost({ plan: { isEnterprise: false, isLoading: true } }),
      );

      expect(screen.queryByText("Role Bindings")).not.toBeInTheDocument();
      expect(screen.queryByTestId("contact-sales-block")).not.toBeInTheDocument();
    });
  });

  describe("given the organization is not on Enterprise", () => {
    /** @scenario The bindings audit is an Enterprise feature */
    it("offers sales and asks for nothing", () => {
      renderWithAuthzHost(
        <RoleBindingsScreen />,
        new FakeAuthzHost({ plan: { isEnterprise: false, isLoading: false } }),
      );

      expect(screen.getByTestId("contact-sales-block")).toBeInTheDocument();
      expect(state.lastQuery?.options.enabled).toBe(false);
    });
  });

  describe("given an Enterprise organization", () => {
    /** @scenario The audit reads every binding in the organization */
    it("asks for the organization in scope", () => {
      renderWithAuthzHost(<RoleBindingsScreen />);

      expect(state.lastQuery?.input).toEqual({ organizationId: "org-1" });
      expect(state.lastQuery?.options.enabled).toBe(true);
    });

    it("says so when the organization has no bindings", () => {
      renderWithAuthzHost(<RoleBindingsScreen />);

      expect(screen.getByText("No role bindings found.")).toBeInTheDocument();
      expect(screen.getByText("0 principals")).toBeInTheDocument();
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
      renderWithAuthzHost(<RoleBindingsScreen />);

      expect(screen.getByText("1 principal")).toBeInTheDocument();
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
      renderWithAuthzHost(<RoleBindingsScreen />);

      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText("OKTA")).toBeInTheDocument();
    });

    /** @scenario The scope filter narrows the audit to one tier */
    it("narrows to one tier and back", () => {
      state.bindings = [
        binding({ id: "b1", userId: "u1", userName: "Ada", scopeType: "ORGANIZATION" }),
        binding({ id: "b2", userId: "u2", userName: "Grace", scopeType: "TEAM" }),
      ];
      renderWithAuthzHost(<RoleBindingsScreen />);

      expect(screen.getByText("2 principals")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Team" }));

      expect(screen.getByText("1 principal")).toBeInTheDocument();
      expect(screen.getByText("Grace")).toBeInTheDocument();
      expect(screen.queryByText("Ada")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "All" }));

      expect(screen.getByText("2 principals")).toBeInTheDocument();
    });

    it("shows a spinner rather than an empty audit while the read is in flight", () => {
      state.bindings = void 0;
      state.isLoading = true;
      renderWithAuthzHost(<RoleBindingsScreen />);

      expect(screen.queryByText("No role bindings found.")).not.toBeInTheDocument();
    });
  });
});
