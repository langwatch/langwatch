/**
 * @vitest-environment jsdom
 * The Roles & access page's Access tab: the grants list, its filters and pages, and
 * granting, changing and revoking, with the server's refusals reported as sent.
 * Spec: specs/rbac/roles-and-access-ui.feature
 */

import { expiryFromDay } from "@langwatch/authz-browser-kit";
import { toDate } from "@langwatch/time";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const { api, state } = vi.hoisted(() => {
  const state = {
    grants: [] as Record<string, unknown>[],
    nextCursor: null as string | null,
    listInputs: [] as unknown[],
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
      authz: { listGrants: { invalidate: state.invalidateGrants } },
      roleBinding: { listForOrg: { invalidate: vi.fn() } },
    }),
    authz: {
      listGrants: {
        useQuery: (input: unknown) => {
          state.listInputs.push(input);
          return {
            data: { grants: state.grants, nextCursor: state.nextCursor },
            isLoading: false,
            isError: false,
          };
        },
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
const { AccessPanel } = await import("../access-panel.tsx");

const panel = <AccessPanel organizationId="org-1" canManage />;

function grant(over: Record<string, unknown>) {
  return {
    id: "gr-1",
    principal: { type: "user", id: "u-sam", name: "Sam" },
    role: { id: "viewer", name: "Viewer", builtIn: true },
    scope: { type: "team", id: "team-1", name: "Platform" },
    status: "active",
    expiresAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  state.grants = [];
  state.nextCursor = null;
  state.listInputs = [];
  state.held = ["organization:manage", "project:view"];
  state.customRoles = [];
  state.createOptions = null;
  vi.clearAllMocks();
});

describe("the Access tab", () => {
  describe("when the reader filters and pages", () => {
    /** @scenario The Access tab narrows by scope and status */
    it("reads the chosen scope and status, and the next page by cursor", () => {
      state.grants = [grant({})];
      state.nextCursor = "1700000000000.Z3ItMQ";
      renderWithAuthzHost(panel);

      fireEvent.click(screen.getByRole("button", { name: "Team" }));
      fireEvent.click(screen.getByRole("button", { name: "Expired" }));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      expect(state.listInputs.at(-1)).toEqual({
        organizationId: "org-1",
        query: {
          limit: 50,
          scopeType: "team",
          status: "expired",
          cursor: "1700000000000.Z3ItMQ",
        },
      });
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

  describe("when the reader changes or revokes a grant", () => {
    beforeEach(async () => {
      state.grants = [grant({})];
      renderWithAuthzHost(panel);
      await userEvent.click(screen.getByRole("button", { name: "Actions for Sam" }));
    });

    /** @scenario The role of a grant is changed in place */
    it("changes only the role of the grant picked", async () => {
      await userEvent.click(await screen.findByRole("menuitem", { name: "Change role" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Sam on Team · Platform")).toBeInTheDocument();
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

      expect(await screen.findByText("Sam loses Viewer on Team · Platform.")).toBeInTheDocument();
      expect(state.revoke).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

      await waitFor(() =>
        expect(state.revoke).toHaveBeenCalledWith({ organizationId: "org-1", grantId: "gr-1" }),
      );
    });
  });

  describe("given a reader who may not manage the organization", () => {
    /** @scenario A reader without manage cannot grant, change or revoke */
    it("disables granting and offers no row actions", () => {
      state.grants = [grant({})];
      renderWithAuthzHost(
        <AccessPanel organizationId="org-1" canManage={false} />,
        new FakeAuthzHost({ grants: new Set() }),
      );

      expect(screen.getByRole("button", { name: "Grant role" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Actions for Sam" })).not.toBeInTheDocument();
    });
  });

  describe("given a refusal from the plan", () => {
    it("disables granting and offers no row actions though the reader may manage", () => {
      state.grants = [grant({})];
      renderWithAuthzHost(
        <AccessPanel organizationId="org-1" canManage refusal="Enterprise only." />,
      );

      expect(screen.getByRole("button", { name: "Grant role" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Actions for Sam" })).not.toBeInTheDocument();
    });
  });
});
