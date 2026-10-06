/**
 * @vitest-environment jsdom
 * The Roles & access page's two tabs: the definitions, and who holds them where.
 * Spec: specs/identity/org-access-cluster.feature, specs/rbac/roles-and-access-ui.feature
 */

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, state } = vi.hoisted(() => {
  const state = {
    bindingReads: 0,
    grantReads: 0,
    bindings: [] as Record<string, unknown>[],
    grants: [] as Record<string, unknown>[],
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
    authz: {
      listGrants: {
        useQuery: () => {
          state.grantReads += 1;
          return { data: { grants: state.grants, nextCursor: null }, isLoading: false };
        },
      },
      revokeGrant: { useMutation: mutation },
      listManagedGrants: {
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
  state.grantReads = 0;
  state.bindings = [];
  state.grants = [];
});

describe("the Roles & access page", () => {
  describe("given an address with no tab", () => {
    it("opens on the roles, reading the assignments only to count who holds each", () => {
      renderWithAuthzHost(<RolesScreen />);

      expect(screen.getByRole("heading", { name: "Roles & access" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Roles" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Predefined roles")).toBeInTheDocument();
      expect(state.bindingReads).toBeGreaterThan(0);
      expect(state.grantReads).toBe(0);
    });

    it("writes the Access tab into the address when it is picked", async () => {
      const { host } = renderWithAuthzHost(<RolesScreen />);

      await userEvent.click(screen.getByRole("tab", { name: "Access" }));

      expect(host.queries).toEqual([{ tab: "assignments" }]);
    });
  });

  describe("given the address the old role bindings page forwards to", () => {
    /** @scenario "The screen says role assignment, never binding" */
    it("opens the Access tab, in the industry's words", () => {
      state.grants = [
        {
          id: "gr-1",
          principal: { type: "user", id: "u1", name: "Sam" },
          role: { id: "member", name: "Member", builtIn: true },
          scope: { type: "team", id: "team-1", name: "Platform" },
          status: "active",
          expiresAt: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ];
      renderWithAuthzHost(<RolesScreen />, new FakeAuthzHost({ query: { tab: "assignments" } }));

      expect(screen.getByRole("tab", { name: "Access" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Sam")).toBeInTheDocument();
      expect(screen.getByText("Team · Platform")).toBeInTheDocument();
      expect(state.grantReads).toBeGreaterThan(0);
      expect(document.body.textContent).not.toMatch(/binding/i);
    });
  });

  describe("given a member who holds a role on a team called Platform", () => {
    /** @scenario A scope is named in full */
    it("names the scope on the Access tab by its kind and its full name", () => {
      state.grants = [
        {
          id: "gr-1",
          principal: { type: "user", id: "u1", name: "Sam" },
          role: { id: "member", name: "Member", builtIn: true },
          scope: { type: "team", id: "team-1", name: "Platform" },
          status: "active",
          expiresAt: null,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ];
      renderWithAuthzHost(<RolesScreen />, new FakeAuthzHost({ query: { tab: "assignments" } }));

      const row = within(screen.getByTestId("grant-row"));
      expect(row.getByText("Team · Platform")).toBeInTheDocument();
      expect(row.queryByText("Platform")).not.toBeInTheDocument();
    });
  });

  describe("given two API keys that hold roles in the organization", () => {
    /** @scenario Every holder is named, whatever kind of holder it is */
    it("gives each key its own row, a key with no name says so, and no row is nameless", () => {
      const keyGrant = (id: string, keyId: string, name: string | null) => ({
        id,
        principal: { type: "apiKey", id: keyId, name },
        role: { id: "viewer", name: "Viewer", builtIn: true },
        scope: { type: "organization", id: "org-1", name: "Acme" },
        status: "active",
        expiresAt: null,
        createdAt: "2026-09-01T00:00:00.000Z",
      });
      state.grants = [keyGrant("gr-1", "key-1", "CI deploy"), keyGrant("gr-2", "key-2", null)];
      renderWithAuthzHost(<RolesScreen />, new FakeAuthzHost({ query: { tab: "assignments" } }));

      const rows = screen.getAllByTestId("grant-row");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText("CI deploy")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("API key")).toBeInTheDocument();
      expect(within(rows[1]!).getByText("An API key with no name yet")).toBeInTheDocument();
      for (const row of rows) {
        expect(within(row).getAllByRole("cell")[0]?.textContent?.trim()).not.toBe("");
      }
    });
  });

  describe("given an organization that is not on Enterprise", () => {
    /** @scenario Access is an Enterprise feature */
    it("offers sales and reads no grant, even on the Access address", async () => {
      renderWithAuthzHost(
        <RolesScreen />,
        new FakeAuthzHost({
          plan: { isEnterprise: false, isLoading: false },
          query: { tab: "assignments" },
        }),
      );

      expect(await screen.findByTestId("contact-sales-block")).toBeInTheDocument();
      expect(state.bindingReads).toBe(0);
      expect(state.grantReads).toBe(0);
    });
  });
});
