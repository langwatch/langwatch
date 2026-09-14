/**
 * @vitest-environment jsdom
 *
 * Groups, and the ones an identity provider owns.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  groups: [] as unknown[],
  detail: null as unknown,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme", teams: [] },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, isLoading: false }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (Component: unknown) => Component,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      group: {
        listAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
    group: {
      listAll: {
        useQuery: () => ({
          data: state.groups,
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      getById: {
        useQuery: () => ({
          data: state.detail,
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      delete: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      create: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      applyEdits: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: { members: [] } }),
      },
    },
    team: {
      getTeamsWithMembers: { useQuery: () => ({ data: [] }) },
    },
    role: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

const { GroupsSection } = await import("~/components/access/GroupsSection");
const { GroupDetailDialog } = await import(
  "~/components/settings/GroupDetailDialog"
);

const directoryGroup = {
  id: "grp_1",
  name: "Platform Engineers",
  slug: "platform-engineers",
  externalId: "ext_1",
  scimSource: "okta",
  memberCount: 7,
  bindings: [
    {
      id: "rb_1",
      role: "MEMBER",
      customRoleId: null,
      customRoleName: null,
      scopeType: "TEAM",
      scopeId: "team_1",
      scopeName: "Platform",
    },
  ],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const handMadeGroup = {
  ...directoryGroup,
  id: "grp_2",
  name: "Hand-made",
  scimSource: null,
  externalId: null,
  bindings: [],
};

function renderGroups() {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <GroupsSection organizationId="org_acme" canManage={true} />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

describe("given an organization with groups", () => {
  beforeEach(() => {
    state.groups = [directoryGroup, handMadeGroup];
    state.detail = {
      ...directoryGroup,
      members: [
        {
          userId: "user_sam",
          name: "Sam Rivera",
          email: "sam@acme.com",
          image: null,
        },
      ],
    };
  });
  afterEach(() => cleanup());

  describe("when the list renders", () => {
    /** @scenario The groups tab holds the hand-made ones as well as the sent ones */
    it("holds the sent groups and the hand-made ones in one list", () => {
      renderGroups();

      const rows = screen.getAllByTestId("group-row");
      expect(rows).toHaveLength(2);
      expect(screen.getByText("Platform Engineers")).toBeTruthy();
      expect(screen.getByText("Hand-made")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Add a group" }),
      ).toBeInTheDocument();
    });

    /** @scenario A directory group is marked in the list */
    it("marks the group the identity provider sends, and names the provider", () => {
      renderGroups();

      const directoryRow = screen
        .getAllByTestId("group-row")
        .find((row) => within(row).queryByText("Platform Engineers"));
      const chip = within(directoryRow!).getByTestId("group-directory-chip");
      expect(chip.textContent).toBe("OKTA");
      expect(within(directoryRow!).getByText("7 people")).toBeTruthy();
    });

    /** @scenario The groups the directory sent say what they grant */
    it("names the roles a sent group carries", () => {
      renderGroups();

      const directoryRow = screen
        .getAllByTestId("group-row")
        .find((row) => within(row).queryByText("Platform Engineers"));
      expect(within(directoryRow!).getByText("Team Platform")).toBeTruthy();
    });

    /** @scenario The groups the directory sent say what they grant */
    /** @scenario A directory group is marked in the list */
    it("leaves a hand-made group unmarked and says it grants nothing", () => {
      renderGroups();

      const handMade = screen
        .getAllByTestId("group-row")
        .find((row) => within(row).queryByText("Hand-made"));
      expect(
        within(handMade!).queryByTestId("group-directory-chip"),
      ).toBeNull();
      expect(within(handMade!).getByText("No role assigned")).toBeTruthy();
    });

    it("says nothing has been created rather than leaving the list blank", () => {
      state.groups = [];
      renderGroups();

      expect(screen.getByTestId("groups-list").textContent).toContain(
        "No group has been created yet",
      );
    });
  });

  describe("when a group the identity provider owns is opened", () => {
    /** @scenario A directory group says why its membership cannot be edited */
    it("explains who owns the membership instead of greying a control in silence", () => {
      render(
        <MemoryRouter>
          <ChakraProvider value={defaultSystem}>
            <GroupDetailDialog
              group={directoryGroup as never}
              organizationId="org_acme"
              canManage={true}
              open={true}
              onClose={vi.fn()}
            />
          </ChakraProvider>
        </MemoryRouter>,
      );

      const notice = screen.getByTestId("group-directory-managed");
      expect(notice.textContent).toContain("OKTA owns who is in this group");
      expect(notice.textContent).toContain(
        "Add and remove people at your identity provider",
      );
      // What it GRANTS is still the administrator's, and the notice says so
      // rather than leaving the whole dialog reading as read-only.
      expect(notice.textContent).toContain("is still yours to change");
      // No control that would be undone on the next push.
      expect(
        screen.queryByRole("button", { name: /Mark .* for removal/ }),
      ).toBeNull();
    });
  });
});
