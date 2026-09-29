/**
 * @vitest-environment jsdom
 * The Roles page's two tabs: the definitions, and who holds them.
 * Spec: specs/identity/org-access-cluster.feature
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, state } = vi.hoisted(() => {
  const state = {
    bindingReads: 0,
    bindings: [] as Record<string, unknown>[],
  };
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

  const api = {
    useUtils: () => ({ role: { getAll: { invalidate: vi.fn() }, getById: { fetch: vi.fn() } } }),
    role: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
      create: { useMutation: mutation },
      update: { useMutation: mutation },
      delete: { useMutation: mutation },
    },
    roleBinding: {
      listForOrg: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          if (options.enabled) state.bindingReads += 1;
          return { data: state.bindings, isLoading: false };
        },
      },
    },
  };

  return { api, state };
});

vi.mock("../../../behavior/authz-api.ts", () => ({ authzApi: api }));

// The pool shares a module graph across files: the screen and its host load fresh over this mock.
vi.resetModules();
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../testing.tsx");
const { default: RolesScreen } = await import("../roles.screen.tsx");

beforeEach(() => {
  state.bindingReads = 0;
  state.bindings = [];
});

describe("the Roles page", () => {
  describe("given an address with no tab", () => {
    it("opens on the roles, reading the assignments only to count who holds each", () => {
      renderWithAuthzHost(<RolesScreen />);

      expect(screen.getByRole("heading", { name: "Roles" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Roles" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Predefined roles")).toBeInTheDocument();
      expect(state.bindingReads).toBeGreaterThan(0);
    });

    it("writes the assignments tab into the address when it is picked", async () => {
      const { host } = renderWithAuthzHost(<RolesScreen />);

      await userEvent.click(screen.getByRole("tab", { name: "Role assignments" }));

      expect(host.queries).toEqual([{ tab: "assignments" }]);
    });
  });

  describe("given the address the old role bindings page forwards to", () => {
    /** @scenario "The screen says role assignment, never binding" */
    it("opens the assignments tab, in the industry's words", () => {
      state.bindings = [
        {
          id: "b1",
          userId: "u1",
          userName: "Sam",
          userEmail: "sam@acme.com",
          userImage: null,
          groupId: null,
          groupName: null,
          groupScimSource: null,
          apiKeyId: null,
          apiKeyName: null,
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          scopeType: "TEAM",
          scopeId: "team-1",
          scopeName: "Platform",
        },
      ];
      renderWithAuthzHost(<RolesScreen />, new FakeAuthzHost({ query: { tab: "assignments" } }));

      expect(screen.getByRole("tab", { name: "Role assignments" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByText("Sam")).toBeInTheDocument();
      expect(state.bindingReads).toBeGreaterThan(0);
      expect(document.body.textContent).not.toMatch(/binding/i);
    });
  });

  describe("given an organization that is not on Enterprise", () => {
    /** @scenario "The bindings audit is an Enterprise feature" */
    it("offers sales and reads no assignment, even on the assignments address", () => {
      renderWithAuthzHost(
        <RolesScreen />,
        new FakeAuthzHost({
          plan: { isEnterprise: false, isLoading: false },
          query: { tab: "assignments" },
        }),
      );

      expect(screen.getByTestId("contact-sales-block")).toBeInTheDocument();
      expect(state.bindingReads).toBe(0);
    });
  });
});
