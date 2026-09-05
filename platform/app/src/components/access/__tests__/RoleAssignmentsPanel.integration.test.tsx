/**
 * @vitest-environment jsdom
 *
 * Every role assignment in the organization, gathered onto whoever holds it.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  assignments: [] as unknown[],
  error: null as unknown,
}));

vi.mock("~/utils/api", () => ({
  api: {
    roleBinding: {
      listForOrg: {
        useQuery: () => ({
          data: state.error ? undefined : state.assignments,
          isLoading: false,
          isError: !!state.error,
          error: state.error,
        }),
      },
    },
  },
}));

const { RoleAssignmentsPanel } = await import("../RoleAssignmentsPanel");

function renderPanel() {
  const onOpenPerson = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <RoleAssignmentsPanel
        organizationId="org_acme"
        onOpenPerson={onOpenPerson}
      />
    </ChakraProvider>,
  );
  return { onOpenPerson };
}

const samOnPlatform = {
  id: "rb_1",
  userId: "user_sam",
  userName: "Sam Rivera",
  userEmail: "sam@acme.com",
  userImage: null,
  groupId: null,
  groupName: null,
  groupScimSource: null,
  apiKeyId: null,
  apiKeyName: null,
  role: "ADMIN",
  customRoleId: null,
  customRoleName: null,
  scopeType: "TEAM",
  scopeId: "team_1",
  scopeName: "Platform",
  memberUserIds: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function samOn({
  id,
  scopeType,
  scopeId,
  scopeName,
}: {
  id: string;
  scopeType: string;
  scopeId: string;
  scopeName: string | null;
}) {
  return { ...samOnPlatform, id, scopeType, scopeId, scopeName };
}

describe("given the role assignments of an organization", () => {
  beforeEach(() => {
    state.assignments = [samOnPlatform];
    state.error = null;
  });
  afterEach(() => cleanup());

  describe("when the tab renders", () => {
    /** @scenario A scope is named in full */
    it("spells the scope out rather than abbreviating it", () => {
      renderPanel();

      expect(screen.getByText("Team Platform")).toBeInTheDocument();
      expect(screen.queryByText("Org")).toBeNull();
      expect(screen.queryByText("🏢")).toBeNull();
    });

    /** @scenario The screen says role assignment, never binding */
    it("counts members and groups, not principals", () => {
      renderPanel();

      expect(screen.getByText("1 member or group")).toBeInTheDocument();
    });

    /** @scenario The screen says role assignment, never binding */
    it("marks a group as a group and names the directory that sent it", () => {
      state.assignments = [
        {
          ...samOnPlatform,
          id: "rb_2",
          userId: null,
          userName: null,
          userEmail: null,
          groupId: "grp_1",
          groupName: "Platform Engineers",
          groupScimSource: "okta",
        },
      ];
      renderPanel();

      expect(screen.getByText("Platform Engineers")).toBeInTheDocument();
      expect(screen.getByText("Group")).toBeInTheDocument();
      expect(screen.getByText("Directory")).toBeInTheDocument();
    });
  });

  describe("when somebody holds the same role in many places", () => {
    beforeEach(() => {
      state.assignments = [
        samOn({
          id: "rb_org",
          scopeType: "ORGANIZATION",
          scopeId: "org_acme",
          scopeName: "Acme",
        }),
        samOn({
          id: "rb_t1",
          scopeType: "TEAM",
          scopeId: "team_1",
          scopeName: "Platform",
        }),
        samOn({
          id: "rb_t2",
          scopeType: "TEAM",
          scopeId: "team_2",
          scopeName: "Support",
        }),
        samOn({
          id: "rb_t3",
          scopeType: "TEAM",
          scopeId: "team_3",
          scopeName: "Research",
        }),
      ];
    });

    /** @scenario One row per holder, however many grants they have */
    it("draws one row for them rather than one per grant", () => {
      renderPanel();

      expect(screen.getAllByTestId("role-assignment-row")).toHaveLength(1);
      expect(screen.getByText("1 member or group")).toBeInTheDocument();
    });

    /** @scenario Identical grants are summarised rather than repeated */
    it("says how many places the role applies instead of listing them all", () => {
      renderPanel();

      expect(screen.getByText("Organization, and 3 teams")).toBeInTheDocument();
      expect(screen.queryByText("Team Research")).toBeNull();
    });

    /** @scenario Identical grants are summarised rather than repeated */
    it("shows every place on request", async () => {
      renderPanel();

      await userEvent.click(screen.getByRole("button", { name: "Show all 4" }));

      const list = within(screen.getByTestId("role-assignments-list"));
      expect(list.getByText("Team Research")).toBeInTheDocument();
      expect(list.getByText("Organization")).toBeInTheDocument();
    });
  });

  describe("when an assignment belongs to an API key", () => {
    beforeEach(() => {
      state.assignments = [
        {
          ...samOnPlatform,
          id: "rb_k1",
          userId: null,
          userName: null,
          userEmail: null,
          apiKeyId: "key_1",
          apiKeyName: "Nightly export",
        },
        {
          ...samOnPlatform,
          id: "rb_k2",
          userId: null,
          userName: null,
          userEmail: null,
          apiKeyId: "key_2",
          apiKeyName: "Billing reader",
        },
      ];
    });

    /** @scenario Every holder is named, whatever kind of holder it is */
    it("names each key rather than pooling them into one unnamed row", () => {
      renderPanel();

      expect(screen.getAllByTestId("role-assignment-row")).toHaveLength(2);
      expect(screen.getByText("Nightly export")).toBeInTheDocument();
      expect(screen.getByText("Billing reader")).toBeInTheDocument();
      expect(screen.getAllByText("API key")).toHaveLength(2);
    });

    /** @scenario Every holder is named, whatever kind of holder it is */
    it("names a key that has no name of its own", () => {
      state.assignments = [
        {
          ...samOnPlatform,
          id: "rb_k3",
          userId: null,
          userName: null,
          userEmail: null,
          apiKeyId: "key_3",
          apiKeyName: null,
        },
      ];
      renderPanel();

      expect(
        screen.getByText("An API key with no name yet"),
      ).toBeInTheDocument();
    });
  });

  describe("when the reader filters by scope", () => {
    beforeEach(() => {
      state.assignments = [
        samOn({
          id: "rb_org",
          scopeType: "ORGANIZATION",
          scopeId: "org_acme",
          scopeName: "Acme",
        }),
        samOn({
          id: "rb_t1",
          scopeType: "TEAM",
          scopeId: "team_1",
          scopeName: "Platform",
        }),
        samOn({
          id: "rb_t2",
          scopeType: "TEAM",
          scopeId: "team_2",
          scopeName: "Support",
        }),
      ];
    });

    /** @scenario The scope filter carries the real numbers */
    it("carries the count of assignments behind each filter", () => {
      renderPanel();

      const all = screen.getByRole("button", { name: /^All/ });
      expect(within(all).getByText("3")).toBeInTheDocument();

      const teams = screen.getByRole("button", { name: /^Teams/ });
      expect(within(teams).getByText("2")).toBeInTheDocument();
    });

    /** @scenario The scope filter carries the real numbers */
    it("keeps the counts steady while a filter is applied", async () => {
      renderPanel();

      await userEvent.click(screen.getByRole("button", { name: /^Teams/ }));

      const all = screen.getByRole("button", { name: /^All/ });
      expect(within(all).getByText("3")).toBeInTheDocument();

      const list = within(screen.getByTestId("role-assignments-list"));
      expect(list.queryByText("Organization")).toBeNull();
      expect(list.getByText("Team Platform")).toBeInTheDocument();
    });
  });

  describe("when nobody holds a role", () => {
    /** @scenario The screen says role assignment, never binding */
    it("says so in the reader's words", () => {
      state.assignments = [];
      renderPanel();

      expect(screen.getByTestId("role-assignments-list").textContent).toContain(
        "Nobody has been assigned a role yet",
      );
    });
  });

  describe("when the assignments cannot be read", () => {
    /** @scenario Reading the assignments does not depend on a second answer */
    it("says what failed in words rather than showing an empty list", () => {
      state.error = new Error("boom");
      renderPanel();

      expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
      expect(screen.queryByTestId("role-assignments-list")).toBeNull();
    });
  });
});
