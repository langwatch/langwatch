/**
 * @vitest-environment jsdom
 * The group detail dialog: what a directory group lets an administrator change.
 * @see specs/identity/directory-administration.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithOrganizationHost } from "../../../testing.tsx";
import { GroupDetailDialog } from "../group-detail-dialog.tsx";

const state = vi.hoisted(() => ({ scimSource: null as string | null }));

vi.mock("../../../behavior/organization-api.ts", () => {
  const answer = (path: string): unknown => {
    if (path === "group.getById") {
      return {
        id: "g1",
        name: "Engineering",
        scimSource: state.scimSource,
        grants: [
          {
            id: "grant-1",
            role: "ADMIN",
            customRoleId: null,
            customRoleName: null,
            scopeType: "ORGANIZATION",
            scopeName: "Acme",
            scopeId: "org-1",
          },
        ],
        members: [{ userId: "ana", name: "Ana", email: "ana@acme.com", image: null }],
      };
    }
    if (path === "organization.getOrganizationWithMembersAndTheirTeams") {
      return { id: "org-1", name: "Acme", members: [], teams: [] };
    }
    return [];
  };
  const endpoint = (path: string) => ({
    useQuery: () => ({
      data: answer(path),
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    invalidate: vi.fn(),
    fetch: vi.fn(),
  });
  const namespace = (prefix: string): Record<string, unknown> =>
    new Proxy(endpoint(prefix) as Record<string, unknown>, {
      get: (target: Record<string, unknown>, name) => {
        if (name in target) return target[name as string];
        if (typeof name !== "string") return void 0;
        return namespace(prefix ? `${prefix}.${name}` : name);
      },
    }) as Record<string, unknown>;
  const root = namespace("");
  root.useUtils = () => root;
  return { api: root };
});

const group = {
  id: "g1",
  name: "Engineering",
  scimSource: null,
  grants: [],
  memberCount: 1,
} as never;

function renderDialog({ scimSource }: { scimSource: string | null }) {
  state.scimSource = scimSource;
  renderWithOrganizationHost(
    <GroupDetailDialog group={group} organizationId="org-1" canManage open onClose={vi.fn()} />,
  );
}

describe("GroupDetailDialog", () => {
  afterEach(cleanup);

  describe("when the group is one its identity provider sends", () => {
    /** @scenario A directory group says why its membership cannot be edited */
    it("says the provider owns who is in it and that the grants stay the administrator's", () => {
      renderDialog({ scimSource: "okta" });

      expect(
        screen.getByText(/Your identity provider \(okta\) owns who is in this group/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/What this group grants is still yours to change/),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove access" })).toBeInTheDocument();
      expect(screen.getAllByText("Organization").length).toBeGreaterThan(0);
    });

    /** @scenario A directory group says why its membership cannot be edited */
    it("offers no control that the next push would undo", () => {
      renderDialog({ scimSource: "okta" });

      expect(screen.queryByPlaceholderText("Group name")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /for removal/ })).not.toBeInTheDocument();
      expect(screen.queryByText("Add member...")).not.toBeInTheDocument();
    });
  });

  describe("when the group is made by hand", () => {
    it("offers the name, the members and the grants alike", () => {
      renderDialog({ scimSource: null });

      expect(screen.getByPlaceholderText("Group name")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Mark Ana for removal/ })).toBeInTheDocument();
      expect(screen.queryByText(/owns who is in this group/)).not.toBeInTheDocument();
    });
  });

  describe("when the directory names only the protocol", () => {
    /** @scenario A directory that names no product is still not called by its protocol */
    it("marks the group as coming from the directory and never shows the protocol as a name", () => {
      renderDialog({ scimSource: "scim" });

      expect(screen.getByTestId("group-directory-chip")).toHaveTextContent("Directory");
      expect(screen.queryByText(/SCIM/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(/^Your identity provider owns who is in this group/),
      ).toBeInTheDocument();
    });
  });
});
