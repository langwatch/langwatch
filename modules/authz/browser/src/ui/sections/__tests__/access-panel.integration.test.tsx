/**
 * @vitest-environment jsdom
 * The Access tab: every grant gathered onto whoever holds it (main's RoleAssignmentsPanel tests),
 * each holder opened onto its grants to change or revoke, refusals reported as sent.
 * Spec: specs/identity/org-access-cluster.feature, specs/rbac/roles-and-access-ui.feature
 */

import { toDate } from "@langwatch/time";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expiryFromDay } from "../../../model/grants/grants.ts";

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const { api, state } = vi.hoisted(() => {
  const state = {
    assignments: [] as Record<string, unknown>[],
    failed: false,
    held: ["organization:manage", "project:view"] as string[],
    customRoles: [] as Record<string, unknown>[],
    create: vi.fn(),
    change: vi.fn(),
    revoke: vi.fn(),
    createOptions: null as MutationOptions | null,
    invalidateGrants: vi.fn(),
  };
  const mutation =
    (run: (input: unknown) => void, keep?: (options: MutationOptions) => void) =>
    (options: MutationOptions) => {
      keep?.(options);
      return { mutate: run, isPending: false };
    };

  const api = {
    useUtils: () => ({
      authz: {
        listGrants: { invalidate: vi.fn() },
        listManagedGrants: { invalidate: state.invalidateGrants },
      },
    }),
    authz: {
      listManagedGrants: {
        useQuery: () => ({
          data: state.failed ? undefined : state.assignments,
          isLoading: false,
          isError: state.failed,
        }),
      },
      effectivePermissions: {
        useQuery: () => ({ data: { scope: null, permissions: state.held } }),
      },
      createGrant: {
        useMutation: mutation(
          (input) => state.create(input),
          (options) => {
            state.createOptions = options;
          },
        ),
      },
      changeGrantRole: { useMutation: mutation((input) => state.change(input)) },
      revokeGrant: { useMutation: mutation((input) => state.revoke(input)) },
    },
    role: { getAll: { useQuery: () => ({ data: state.customRoles }) } },
    organization: {
      getAllOrganizationMembers: {
        useQuery: () => ({ data: [{ id: "u-sam", name: "Sam", email: "sam@acme.com" }] }),
      },
    },
    group: { listAll: { useQuery: () => ({ data: [{ id: "g-eng", name: "Engineering" }] }) } },
  };

  return { api, state };
});

vi.mock("../../../behavior/authz-api.ts", () => ({ authzApi: api }));

// The pool shares a module graph across files: the panel and its host load fresh over this mock.
vi.resetModules();
const { FakeAuthzHost, renderWithAuthzHost } = await import("../../../testing.tsx");
const { AccessPanel, HOLDER_PAGE_SIZE } = await import("../access-panel.tsx");

const panel = <AccessPanel organizationId="org-1" canManage />;

/** One assignment as `authz.listManagedGrants` sends it: Sam, Viewer, on team Platform. */
function assignment(over: Record<string, unknown> = {}) {
  return {
    id: "gr-1",
    userId: "u-sam",
    userName: "Sam",
    userEmail: "sam@acme.com",
    userImage: null,
    groupId: null,
    groupName: null,
    groupScimSource: null,
    apiKeyId: null,
    apiKeyName: null,
    role: "VIEWER",
    customRoleId: null,
    customRoleName: null,
    scopeType: "TEAM",
    scopeId: "team-1",
    scopeName: "Platform",
    memberUserIds: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: null,
    ...over,
  };
}

const notAPerson = { userId: null, userName: null, userEmail: null };
const samOnOrgAndThreeTeams = [
  assignment({ id: "gr-org", scopeType: "ORGANIZATION", scopeId: "org-1", scopeName: "Acme" }),
  assignment({ id: "gr-t1" }),
  assignment({ id: "gr-t2", scopeId: "team-2", scopeName: "Support" }),
  assignment({ id: "gr-t3", scopeId: "team-3", scopeName: "Research" }),
];

async function openHolder(name: string) {
  await userEvent.click(screen.getByRole("button", { name: `Grants of ${name}` }));
}

beforeEach(() => {
  state.assignments = [assignment()];
  state.failed = false;
  state.held = ["organization:manage", "project:view"];
  state.customRoles = [];
  state.createOptions = null;
  vi.clearAllMocks();
});

describe("the Access tab", () => {
  describe("when it renders", () => {
    /** @scenario A scope is named in full */
    it("spells the scope out rather than abbreviating it", () => {
      renderWithAuthzHost(panel);

      expect(screen.getByText("Team Platform")).toBeInTheDocument();
      expect(screen.queryByText("Org")).toBeNull();
    });

    /** @scenario The screen says role assignment, never binding */
    it("counts members and groups, and marks a group with the directory that sent it", () => {
      state.assignments = [
        assignment(),
        assignment({
          id: "gr-2",
          ...notAPerson,
          groupId: "g-1",
          groupName: "Platform Engineers",
          groupScimSource: "okta",
        }),
      ];
      renderWithAuthzHost(panel);

      expect(screen.getByText("2 members and groups")).toBeInTheDocument();
      expect(screen.getByText("Platform Engineers")).toBeInTheDocument();
      expect(screen.getByText("Group")).toBeInTheDocument();
      expect(screen.getByText("Directory")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/binding/i);
    });

    /** @scenario The screen says role assignment, never binding */
    it("says so in the reader's words when nobody holds a role", () => {
      state.assignments = [];
      renderWithAuthzHost(panel);

      expect(screen.getByTestId("role-assignments-list").textContent).toContain(
        "Nobody has been assigned a role yet",
      );
    });
  });

  describe("when somebody holds the same role in many places", () => {
    beforeEach(() => {
      state.assignments = samOnOrgAndThreeTeams;
    });

    /** @scenario One row per holder, however many grants they have */
    it("draws one row for them rather than one per grant", () => {
      renderWithAuthzHost(panel);

      expect(screen.getAllByTestId("role-assignment-row")).toHaveLength(1);
      expect(screen.getByText("1 member or group")).toBeInTheDocument();
    });

    /** @scenario Identical grants are summarised rather than repeated */
    it("says how many places the role applies, and shows every one on request", async () => {
      renderWithAuthzHost(panel);

      expect(screen.getByText("Organization, and 3 teams")).toBeInTheDocument();
      expect(screen.queryByText("Team Research")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Show all 4" }));

      const list = within(screen.getByTestId("role-assignments-list"));
      expect(list.getByText("Team Research")).toBeInTheDocument();
      expect(list.getByText("Organization")).toBeInTheDocument();
    });
  });

  describe("when assignments belong to API keys", () => {
    /** @scenario Every holder is named, whatever kind of holder it is */
    it("gives each key its own named row, and a key with no name says so", () => {
      state.assignments = [
        assignment({ id: "gr-k1", ...notAPerson, apiKeyId: "key-1", apiKeyName: "Nightly export" }),
        assignment({ id: "gr-k2", ...notAPerson, apiKeyId: "key-2", apiKeyName: null }),
      ];
      renderWithAuthzHost(panel);

      expect(screen.getAllByTestId("role-assignment-row")).toHaveLength(2);
      expect(screen.getByText("Nightly export")).toBeInTheDocument();
      expect(screen.getByText("An API key with no name yet")).toBeInTheDocument();
      expect(screen.getAllByText("API key")).toHaveLength(2);
    });
  });

  describe("when the reader filters by scope", () => {
    beforeEach(() => {
      state.assignments = samOnOrgAndThreeTeams.slice(0, 3);
    });

    /** @scenario The scope filter carries the real numbers */
    it("carries the count behind each filter, steady while a filter is applied", async () => {
      renderWithAuthzHost(panel);

      expect(
        within(screen.getByRole("button", { name: /^All/ })).getByText("3"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("button", { name: /^Teams/ })).getByText("2"),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /^Teams/ }));

      expect(
        within(screen.getByRole("button", { name: /^All/ })).getByText("3"),
      ).toBeInTheDocument();
      const list = within(screen.getByTestId("role-assignments-list"));
      expect(list.queryByText("Organization")).toBeNull();
      expect(list.getByText("Team Platform")).toBeInTheDocument();
    });
  });

  describe("when the assignments cannot be read", () => {
    /** @scenario Reading the assignments does not depend on a second answer */
    it("says what failed in words rather than showing an empty list", () => {
      state.failed = true;
      renderWithAuthzHost(panel);

      expect(screen.getByTestId("section-error-notice")).toHaveTextContent(
        "Couldn't load your role assignments",
      );
      expect(screen.queryByTestId("role-assignments-list")).toBeNull();
    });
  });

  describe("given grants to a member, a group and an API key", () => {
    /** @scenario The Access tab lists every grant in the organization, under its holder */
    it("draws a row per holder, each opening onto its grants with role, scope and end date", async () => {
      state.assignments = [
        assignment(),
        assignment({
          id: "gr-2",
          ...notAPerson,
          groupId: "g-eng",
          groupName: "Engineering",
          customRoleId: "role_ops",
          customRoleName: "Ops",
          role: "CUSTOM",
          expiresAt: "2099-12-31T12:00:00.000Z",
        }),
        assignment({
          id: "gr-3",
          ...notAPerson,
          apiKeyId: "k1",
          expiresAt: "2020-01-01T00:00:00.000Z",
        }),
      ];
      renderWithAuthzHost(panel);

      expect(screen.getAllByTestId("role-assignment-row")).toHaveLength(3);
      await openHolder("Sam");
      await openHolder("Engineering");
      await openHolder("An API key with no name yet");

      const [sam, group, key] = screen.getAllByTestId("role-assignment-row");
      const samGrant = within(within(sam!).getByTestId("grant-row"));
      expect(samGrant.getByText("Viewer")).toBeInTheDocument();
      expect(samGrant.getByText("Team Platform")).toBeInTheDocument();
      expect(samGrant.getByText("No end date")).toBeInTheDocument();
      expect(
        within(within(group!).getByTestId("grant-row")).getByText("31 Dec 2099"),
      ).toBeInTheDocument();
      expect(
        within(within(key!).getByTestId("grant-row")).getByText("Expired"),
      ).toBeInTheDocument();
    });
  });

  describe("when the reader narrows by scope and status, and pages", () => {
    /** @scenario The Access tab narrows by scope and status */
    it("lists only holders of an expired team grant, each with only those grants", async () => {
      state.assignments = [
        assignment({ id: "gr-live" }),
        assignment({
          id: "gr-old",
          scopeId: "team-2",
          scopeName: "Support",
          expiresAt: "2020-01-01T00:00:00.000Z",
        }),
        assignment({
          id: "gr-org",
          userId: "u-ana",
          userName: "Ana",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          expiresAt: "2020-01-01T00:00:00.000Z",
        }),
      ];
      renderWithAuthzHost(panel);

      await userEvent.click(screen.getByRole("button", { name: /^Teams/ }));
      await userEvent.click(screen.getByRole("button", { name: "Expired" }));

      expect(screen.getAllByTestId("role-assignment-row")).toHaveLength(1);
      await openHolder("Sam");
      const grants = screen.getAllByTestId("grant-row");
      expect(grants).toHaveLength(1);
      expect(within(grants[0]!).getByText("Team Support")).toBeInTheDocument();
    });

    /** @scenario The Access tab narrows by scope and status */
    it("pages a list longer than a page, paging onward showing the next holders", async () => {
      state.assignments = Array.from({ length: HOLDER_PAGE_SIZE + 1 }, (_, index) => {
        const name = `Holder ${String(index).padStart(3, "0")}`;
        return assignment({ id: `gr-${index}`, userId: `u-${index}`, userName: name });
      });
      renderWithAuthzHost(panel);

      expect(screen.getAllByTestId("role-assignment-row")).toHaveLength(HOLDER_PAGE_SIZE);
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Next" }));

      const rows = screen.getAllByTestId("role-assignment-row");
      expect(rows).toHaveLength(1);
      expect(
        within(rows[0]!).getByText(`Holder ${String(HOLDER_PAGE_SIZE).padStart(3, "0")}`),
      ).toBeInTheDocument();
    });
  });

  describe("when the reader grants a role", () => {
    /** @scenario An administrator grants a role to a member on a scope */
    it("creates one grant for the member, role and organization, ending on the day picked", async () => {
      const { host } = renderWithAuthzHost(panel);

      fireEvent.click(screen.getByRole("button", { name: "Grant role" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Who"), { target: { value: "user:u-sam" } });
      fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "viewer" } });
      fireEvent.change(within(dialog).getByLabelText("Ends on"), {
        target: { value: "2026-12-31" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Grant role" }));

      expect(state.create).toHaveBeenCalledWith({
        organizationId: "org-1",
        grant: {
          principal: { type: "user", id: "u-sam" },
          roleId: "viewer",
          scope: { type: "organization", id: "org-1" },
          expiresAt: toDate(expiryFromDay("2026-12-31")!),
        },
      });
      state.createOptions?.onSuccess?.();
      expect(host.successes).toEqual([{ title: "Role granted" }]);
      expect(state.invalidateGrants).toHaveBeenCalled();
    });

    /** @scenario A refused grant tells the reader what they lack */
    it("hands the server's refusal, missing permissions and all, to the reader", async () => {
      const { host } = renderWithAuthzHost(panel);
      fireEvent.click(screen.getByRole("button", { name: "Grant role" }));
      await screen.findByRole("dialog");
      const refusal = Object.assign(new Error("grant_exceeds_caller_permissions"), {
        data: {
          domainError: {
            kind: "grant_exceeds_caller_permissions",
            meta: { missingPermissions: ["project:delete"] },
          },
        },
      });

      state.createOptions?.onError?.(refusal);

      expect(host.failures).toEqual([
        { error: refusal, fallbackTitle: "Couldn't grant this role" },
      ]);
      expect(host.successes).toEqual([]);
    });
  });

  describe("when the reader opens a holder and changes or revokes one of its grants", () => {
    beforeEach(async () => {
      renderWithAuthzHost(panel);
      await openHolder("Sam");
      await userEvent.click(
        screen.getByRole("button", { name: "Actions for Sam: Viewer on Team Platform" }),
      );
    });

    /** @scenario The role of a grant is changed in place */
    it("changes only the role of the grant picked", async () => {
      await userEvent.click(await screen.findByRole("menuitem", { name: "Change role" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Sam on Team Platform")).toBeInTheDocument();
      fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "member" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

      expect(state.change).toHaveBeenCalledWith({
        organizationId: "org-1",
        grantId: "gr-1",
        roleId: "member",
      });
    });

    /** @scenario Revoking access is confirmed first */
    it("asks first, naming who loses what where, then revokes that grant", async () => {
      await userEvent.click(await screen.findByRole("menuitem", { name: "Revoke" }));

      expect(await screen.findByText("Sam loses Viewer on Team Platform.")).toBeInTheDocument();
      expect(state.revoke).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

      await waitFor(() =>
        expect(state.revoke).toHaveBeenCalledWith({ organizationId: "org-1", grantId: "gr-1" }),
      );
    });
  });

  describe("given a reader who may not manage the organization", () => {
    /** @scenario A reader without manage cannot grant, change or revoke */
    it("disables granting, and an opened holder's grants offer no actions", async () => {
      renderWithAuthzHost(
        <AccessPanel organizationId="org-1" canManage={false} />,
        new FakeAuthzHost({ grants: new Set() }),
      );

      expect(screen.getByRole("button", { name: "Grant role" })).toBeDisabled();
      await openHolder("Sam");
      expect(screen.getByTestId("grant-row")).toBeInTheDocument();
      expect(screen.queryByTestId("grant-row-actions")).not.toBeInTheDocument();
    });
  });
});
