/**
 * @see specs/members/member-access-editing.feature
 * The saved batch describes the state the admin WANTS, so re-asserting something already
 * true is a success and not an error.
 */

/*
 * A customer reducing seats hit the opposite three ways in one afternoon: a re-added row
 * tripped a unique index, a removal whose id the seat change had rewritten read as "not
 * found", and a staged id belonging to someone else was accepted at face value.
 */

/*
 * The writer runs over a store rather than Prisma: what is under test is the batch's own
 * arithmetic — which rows it revokes, which it attaches, and which it refuses — and every
 * one of those decisions is made above the repository.
 */
import {
  type AuthzApplyMemberBindingsInput,
  type AuthzAttachBindingsInput,
  type AuthzRevokeBindingsInput,
  type OrganizationRole,
  type RoleBindingScopeType,
  type TeamUserRole,
} from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import type { AuthzCompatibilityLedgerPort } from "../../ports/authz-compatibility-ledger.port";
import type {
  AuthzBindingRepository,
  AuthzBindingScopeRow,
  AuthzManagedBindingRow,
} from "../../repositories/authz-binding.repository";
import { AuthzBindingWriterService } from "../authz-binding-writer.service";

const ORGANIZATION_ID = "organization_1";
const MEMBER_ID = "user_member";
const COMPANION_ID = "user_companion";
const GROUP_ID = "group_1";
const SOLO_TEAM_ID = "team_solo";
const SHARED_TEAM_ID = "team_shared";
const PROJECT_ID = "project_1";
const CUSTOM_ROLE_ID = "role_custom";
const ACTOR = { type: "user" as const, id: "user_admin" };

const SCOPES: readonly AuthzBindingScopeRow[] = [
  { type: "ORGANIZATION", id: ORGANIZATION_ID, name: "Acme", personalWorkspaceName: null },
  { type: "TEAM", id: SOLO_TEAM_ID, name: "Solo", personalWorkspaceName: null },
  { type: "TEAM", id: SHARED_TEAM_ID, name: "Shared", personalWorkspaceName: null },
  { type: "PROJECT", id: PROJECT_ID, name: "Widgets", personalWorkspaceName: null },
];

/** The identity a stored row is unique on, which is what "already holds it" means. */
function identityOf(row: {
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  role: string;
  customRoleId: string | null;
  scopeType: string;
  scopeId: string;
}): string {
  const principal = row.userId ?? row.groupId ?? row.apiKeyId;
  const role = row.customRoleId === null ? `builtin:${row.role}` : `custom:${row.customRoleId}`;
  return [principal, row.scopeType, row.scopeId, role].join("|");
}

/**
 * One organization's access rows, held the way the database holds them: unique on the
 * principal, scope and role, and revoked by id.
 */
class MemberAccessStore {
  readonly rows: AuthzManagedBindingRow[] = [];
  private next = 0;

  constructor(private readonly seatByUser: Map<string, OrganizationRole>) {}

  newBindingId(): string {
    this.next += 1;
    return `binding_new_${this.next}`;
  }

  seed(row: Omit<AuthzManagedBindingRow, "organizationId">): AuthzManagedBindingRow {
    const seeded = { ...row, organizationId: ORGANIZATION_ID };
    this.rows.push(seeded);
    return seeded;
  }

  seatOf(userId: string): OrganizationRole | null {
    return this.seatByUser.get(userId) ?? null;
  }

  setSeat(userId: string, seat: OrganizationRole): void {
    this.seatByUser.set(userId, seat);
  }

  rowFor(input: { userId: string; scopeId: string }): AuthzManagedBindingRow | undefined {
    return this.rows.find((row) => row.userId === input.userId && row.scopeId === input.scopeId);
  }

  has(bindingId: string): boolean {
    return this.rows.some((row) => row.id === bindingId);
  }

  countMatching(predicate: (row: AuthzManagedBindingRow) => boolean): number {
    return this.rows.filter(predicate).length;
  }

  bindings(): AuthzBindingRepository {
    return {
      findScopeRows: async ({
        scopes,
      }: {
        scopes: ReadonlyArray<{ scopeType: string; scopeId: string }>;
      }) =>
        SCOPES.filter((scope) =>
          scopes.some((asked) => asked.scopeType === scope.type && asked.scopeId === scope.id),
        ),
      tryFindOrganizationRole: async ({ userId }: { userId: string }) => this.seatOf(userId),
      // Only rows this member actually holds — a staged id naming another
      // principal, or one a concurrent change already deleted, simply is not
      // among them, which is what makes both saves clean.
      findDirectUserBindings: async ({
        userId,
        bindingIds,
      }: {
        userId: string;
        bindingIds: readonly string[];
      }) => this.rows.filter((row) => row.userId === userId && bindingIds.includes(row.id)),
      findAssignableRoles: async ({ roleIds }: { roleIds: readonly string[] }) =>
        roleIds.includes(CUSTOM_ROLE_ID)
          ? [{ id: CUSTOM_ROLE_ID, permissions: ["traces:view"] }]
          : [],
      hasBindingsForUser: async () => false,
      hasLegacySharedTeamMembership: async () => false,
      findGroupMembers: async () => [],
      findUserGroups: async () => [],
      isGroupInOrganization: async () => true,
      isApiKeyInOrganization: async () => true,
      tryFindBinding: async ({ bindingId }: { bindingId: string }) =>
        this.rows.find((row) => row.id === bindingId) ?? null,
    } as unknown as AuthzBindingRepository;
  }

  ledger(): AuthzCompatibilityLedgerPort {
    return {
      attachBindings: async ({ bindings, onDuplicate }: AuthzAttachBindingsInput) => {
        const attached: string[] = [];
        const duplicates: string[] = [];
        for (const binding of bindings) {
          const principal = binding.principal as {
            userId?: string;
            groupId?: string;
            apiKeyId?: string;
          };
          const candidate: AuthzManagedBindingRow = {
            id: binding.bindingId,
            organizationId: ORGANIZATION_ID,
            userId: principal.userId ?? null,
            groupId: principal.groupId ?? null,
            apiKeyId: principal.apiKeyId ?? null,
            role: binding.role as TeamUserRole,
            customRoleId: binding.customRoleId ?? null,
            scopeType: binding.scopeType as RoleBindingScopeType,
            scopeId: binding.scopeId,
          };
          const identity = identityOf(candidate);
          if (this.rows.some((row) => identityOf(row) === identity)) {
            if (onDuplicate === "reject") {
              throw Object.assign(new Error("duplicate"), {
                code: "role_binding_already_exists",
              });
            }
            duplicates.push(binding.bindingId);
            continue;
          }
          this.rows.push(candidate);
          attached.push(binding.bindingId);
        }
        return { attached, duplicates };
      },
      revokeBindings: async ({ bindingIds }: AuthzRevokeBindingsInput) => {
        for (const bindingId of bindingIds) {
          const index = this.rows.findIndex((row) => row.id === bindingId);
          if (index >= 0) this.rows.splice(index, 1);
        }
      },
    } as unknown as AuthzCompatibilityLedgerPort;
  }
}

/**
 * The member the dialog is open on: an admin of their own team, a member of a shared one,
 * beside a companion and a group holding rows of their own.
 */
function world(options: { seat?: OrganizationRole } = {}) {
  const store = new MemberAccessStore(
    new Map<string, OrganizationRole>([
      [MEMBER_ID, options.seat ?? "MEMBER"],
      [COMPANION_ID, "MEMBER"],
    ]),
  );

  const soloRow = store.seed({
    id: "binding_solo",
    userId: MEMBER_ID,
    groupId: null,
    apiKeyId: null,
    role: "ADMIN",
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: SOLO_TEAM_ID,
  });
  const companionRow = store.seed({
    id: "binding_companion",
    userId: COMPANION_ID,
    groupId: null,
    apiKeyId: null,
    role: "ADMIN",
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: SHARED_TEAM_ID,
  });
  const groupRow = store.seed({
    id: "binding_group",
    userId: null,
    groupId: GROUP_ID,
    apiKeyId: null,
    role: "MEMBER",
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: SHARED_TEAM_ID,
  });

  const writer = AuthzBindingWriterService.create({
    bindings: store.bindings(),
    ledger: store.ledger(),
    newBindingId: () => store.newBindingId(),
  });

  const save = (
    batch: Pick<AuthzApplyMemberBindingsInput, "bindingIdsToDelete" | "bindingsToCreate">,
  ) =>
    writer.applyMemberBindings({
      organizationId: ORGANIZATION_ID,
      userId: MEMBER_ID,
      actor: ACTOR,
      ...batch,
    });

  return { store, save, soloRow, companionRow, groupRow };
}

describe("given an organization admin editing a member's access", () => {
  describe("when they re-add an access row the member already holds", () => {
    /** @scenario "Re-adding an access row the member already holds saves cleanly" */
    it("saves cleanly and keeps the access exactly once", async () => {
      const { store, save } = world();

      await expect(
        save({
          bindingIdsToDelete: [],
          bindingsToCreate: [{ role: "ADMIN", scopeType: "TEAM", scopeId: SOLO_TEAM_ID }],
        }),
      ).resolves.toEqual({ success: true });

      expect(
        store.countMatching(
          (row) => row.userId === MEMBER_ID && row.scopeId === SOLO_TEAM_ID && row.role === "ADMIN",
        ),
      ).toBe(1);
    });

    /** @scenario "Re-adding an access row the member already holds saves cleanly" */
    it("stages the same addition twice without failing", async () => {
      const { store, save } = world();
      const addition = {
        role: "MEMBER" as const,
        scopeType: "TEAM" as const,
        scopeId: SHARED_TEAM_ID,
      };

      await expect(
        save({ bindingIdsToDelete: [], bindingsToCreate: [addition, addition] }),
      ).resolves.toEqual({ success: true });

      expect(
        store.countMatching(
          (row) =>
            row.userId === MEMBER_ID && row.scopeId === SHARED_TEAM_ID && row.role === "MEMBER",
        ),
      ).toBe(1);
    });
  });

  describe("when a staged removal points at a row that is already gone", () => {
    /** @scenario "Removing an access row that is already gone saves cleanly" */
    it("saves cleanly rather than reporting the row as not found", async () => {
      const { store, save, soloRow } = world();
      // The concurrent change the admin never saw.
      store.rows.splice(store.rows.indexOf(soloRow), 1);

      await expect(
        save({ bindingIdsToDelete: [soloRow.id], bindingsToCreate: [] }),
      ).resolves.toEqual({ success: true });
    });
  });

  describe("when the seat change corrected the rows before the batch arrived", () => {
    /** @scenario "Moving to a Lite Member seat while removing an access row saves cleanly" */
    it("saves the whole edit cleanly, and the removal lands", async () => {
      const { store, save, soloRow } = world();

      // The dialog's order: the seat lands first and corrects the member's team
      // rows down to Viewer in place, and only then does the batch arrive
      // carrying the id the admin staged before any of that.
      store.setSeat(MEMBER_ID, "EXTERNAL");
      soloRow.role = "VIEWER";

      await expect(
        save({ bindingIdsToDelete: [soloRow.id], bindingsToCreate: [] }),
      ).resolves.toEqual({ success: true });

      expect(store.rowFor({ userId: MEMBER_ID, scopeId: SOLO_TEAM_ID })).toBeUndefined();
      expect(store.seatOf(MEMBER_ID)).toBe("EXTERNAL");
    });
  });

  describe("when the staged removals name another principal's rows", () => {
    /** @scenario "A member's save cannot remove another principal's access" */
    it("leaves the other member's row and the group's row alone", async () => {
      const { store, save, companionRow, groupRow } = world();

      await expect(
        save({
          bindingIdsToDelete: [companionRow.id, groupRow.id],
          bindingsToCreate: [],
        }),
      ).resolves.toEqual({ success: true });

      expect(store.has(companionRow.id)).toBe(true);
      expect(store.has(groupRow.id)).toBe(true);
    });
  });

  describe("given the member is on a Lite Member seat", () => {
    /** @scenario "The access batch refuses an access row above Viewer for a member on a Lite Member seat" */
    it("refuses a team row above Viewer, writing nothing", async () => {
      const { store, save } = world({ seat: "EXTERNAL" });

      await expect(
        save({
          bindingIdsToDelete: [],
          bindingsToCreate: [{ role: "ADMIN", scopeType: "TEAM", scopeId: SHARED_TEAM_ID }],
        }),
      ).rejects.toMatchObject({ code: "lite_member_viewer_only" });

      expect(
        store.countMatching((row) => row.userId === MEMBER_ID && row.scopeId === SHARED_TEAM_ID),
      ).toBe(0);
    });

    /** @scenario "The access batch refuses an access row above Viewer for a member on a Lite Member seat" */
    it("refuses a project row above Viewer", async () => {
      const { save } = world({ seat: "EXTERNAL" });

      await expect(
        save({
          bindingIdsToDelete: [],
          bindingsToCreate: [{ role: "MEMBER", scopeType: "PROJECT", scopeId: PROJECT_ID }],
        }),
      ).rejects.toMatchObject({ code: "lite_member_viewer_only" });
    });

    /** @scenario "The access batch refuses a custom role for a member on a Lite Member seat" */
    it("refuses a custom role row", async () => {
      const { save } = world({ seat: "EXTERNAL" });

      await expect(
        save({
          bindingIdsToDelete: [],
          bindingsToCreate: [
            {
              role: "CUSTOM",
              customRoleId: CUSTOM_ROLE_ID,
              scopeType: "TEAM",
              scopeId: SOLO_TEAM_ID,
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "lite_member_viewer_only" });
    });

    /** @scenario "The access batch refuses an organization access row for a member on a Lite Member seat" */
    it("refuses an organization row even at Viewer", async () => {
      const { save } = world({ seat: "EXTERNAL" });

      await expect(
        save({
          bindingIdsToDelete: [],
          bindingsToCreate: [
            { role: "VIEWER", scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
          ],
        }),
      ).rejects.toMatchObject({ code: "lite_member_viewer_only" });
    });

    /** @scenario "The access batch accepts a Viewer row for a member on a Lite Member seat" */
    it("accepts a Viewer team row", async () => {
      const { store, save } = world({ seat: "EXTERNAL" });

      await expect(
        save({
          bindingIdsToDelete: [],
          bindingsToCreate: [{ role: "VIEWER", scopeType: "TEAM", scopeId: SHARED_TEAM_ID }],
        }),
      ).resolves.toEqual({ success: true });

      expect(store.rowFor({ userId: MEMBER_ID, scopeId: SHARED_TEAM_ID })?.role).toBe("VIEWER");
    });
  });
});
