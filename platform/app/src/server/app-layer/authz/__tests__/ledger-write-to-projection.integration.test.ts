/**
 * @vitest-environment node
 *
 * ADR-092 §13 decision 10, end to end: caller → command → fold → rows.
 *
 * Every other suite around the ledger holds one side still. The emission
 * tests mock the projection store, so they prove a command was sent; the
 * store tests mock the senders, so they prove a fold state becomes rows.
 * Neither proves the claim the PR actually makes — that a grant write a
 * customer makes ends up as BOTH heads in Postgres.
 *
 * So nothing between the two is mocked here. `GrantsLedgerWriter` sends
 * through the real `AttachGrantsCommand` / `DefineRolesCommand` handlers, the
 * events they emit go through the real `AuthzGrantsStateFoldProjection` (and
 * therefore the real reducer in `@langwatch/authz-server`), and the folded
 * state is written by the real `PrismaAuthzGrantsProjectionRepository`
 * against a real database. The only stand-in is the queue itself: the fold
 * runs inline rather than through BullMQ, which is the one boundary this
 * suite is deliberately not about.
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing";
import type { Command } from "~/server/event-sourcing/commands/command";
import {
  AttachGrantsCommand,
  DefineRolesCommand,
} from "~/server/event-sourcing/pipelines/authz-grants/commands/grantsLedgerCommands";
import {
  type AuthzGrantsFoldState,
  AuthzGrantsStateFoldProjection,
} from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsState.foldProjection";
import type {
  AttachGrantsCommandData,
  DefineRolesCommandData,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/commands";
import {
  ATTACH_GRANTS_COMMAND_TYPE,
  DEFINE_ROLES_COMMAND_TYPE,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import type { AuthzGrantsEvent } from "~/server/event-sourcing/pipelines/authz-grants/schemas/events";
import type { StoredProjection } from "~/server/event-sourcing/projections/stateProjection.types";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { type AuthzGrantsCommandSenders, GrantsLedgerWriter } from "../ledger";
import { PrismaAuthzGrantsProjectionRepository } from "../repositories/authz-grants-projection.prisma.repository";

const ns = `authz-e2e-${nanoid(8)}`;

describe("given an organization whose grant writes go through the ledger", () => {
  let organization: Organization;
  let userId: string;

  const repository = new PrismaAuthzGrantsProjectionRepository(prisma);
  const projection = new AuthzGrantsStateFoldProjection({ store: repository });

  /**
   * The queue's job, run inline: load what the projection already holds, fold
   * this batch onto it, store. The same load/apply/store cycle
   * `.withProjection()` drives, against the same repository — only the
   * per-org lock and the retry are missing.
   */
  async function foldAndStore(events: AuthzGrantsEvent[]): Promise<void> {
    const context = {
      aggregateId: organization.id,
      tenantId: createTenantId(organization.id),
    };
    const loaded = await repository.load(organization.id, context);
    let state = loaded?.state ?? projection.init();
    for (const event of events) {
      state = projection.apply(state, event);
    }
    const stored: StoredProjection<AuthzGrantsFoldState> = {
      state,
      cursor: {
        acceptedAt: Date.now(),
        eventId: events[events.length - 1]!.id,
      },
      occurredAt: state.LastEventOccurredAt,
      createdAt: state.CreatedAt,
      updatedAt: state.UpdatedAt,
      version: projection.version,
    };
    await repository.store(stored, context);
  }

  function envelope<T>({ type, data }: { type: string; data: T }): Command<T> {
    return {
      tenantId: createTenantId(organization.id),
      aggregateId: organization.id,
      type,
      data,
    } as Command<T>;
  }

  async function sendAttachGrants(
    data: AttachGrantsCommandData,
  ): Promise<void> {
    await foldAndStore(
      await new AttachGrantsCommand().handle(
        envelope({ type: ATTACH_GRANTS_COMMAND_TYPE, data }),
      ),
    );
  }

  async function sendDefineRoles(data: DefineRolesCommandData): Promise<void> {
    await foldAndStore(
      await new DefineRolesCommand().handle(
        envelope({ type: DEFINE_ROLES_COMMAND_TYPE, data }),
      ),
    );
  }

  const senders = {
    attachGrants: { send: sendAttachGrants },
    defineRoles: { send: sendDefineRoles },
  } as unknown as AuthzGrantsCommandSenders;

  const writer = () =>
    new GrantsLedgerWriter(prisma, {
      // Past its genesis import: the fork under test is the ledger side.
      onLedgerWrites: async () => true,
      commands: async () => ({ commands: senders }),
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Ledger E2E Org", slug: `--test-org-${ns}` },
    });
    const user = await prisma.user.create({
      data: { name: "Sam", email: `${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
  });

  afterAll(async () => {
    if (!organization?.id) return;
    await cleanupTestRows(prisma, [
      ["grant", { organizationId: organization.id }],
      ["roleBinding", { organizationId: organization.id }],
      ["role", { organizationId: organization.id }],
      ["customRole", { organizationId: organization.id }],
      ["authzProjectionCursor", { organizationId: organization.id }],
      ["authzCutoverProjection", { organizationId: organization.id }],
      ["organizationUser", { organizationId: organization.id }],
      ...(userId ? ([["user", { id: userId }]] as const) : []),
      ["organization", { id: organization.id }],
    ]);
  });

  describe("when an admin attaches a team binding", () => {
    /** @scenario "A live grant write lands both projected heads through the real fold" */
    it("lands the projected grant and the legacy-shaped binding row beside it", async () => {
      const bindingId = `rb_${ns}_team`;

      await writer().attachBindings({
        organizationId: organization.id,
        bindings: [
          {
            bindingId,
            principal: { userId },
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: `team_${ns}`,
          },
        ],
        actor: { type: "user", id: userId },
        onDuplicate: "reject",
      });

      expect(
        await prisma.grant.findFirst({
          where: { organizationId: organization.id, id: bindingId },
        }),
      ).toMatchObject({
        organizationId: organization.id,
        principalType: "USER",
        principalId: userId,
        roleKey: "member",
        source: "grants-service",
        scopeType: "TEAM",
        scopeId: `team_${ns}`,
      });

      // Same id on purpose: the compat row IS the grant, in the shape the
      // legacy resolver reads. That is what makes a compat delete unable to
      // touch a legacy-authored row — its id is not a grant id.
      expect(
        await prisma.roleBinding.findFirst({
          where: { organizationId: organization.id, id: bindingId },
        }),
      ).toMatchObject({
        organizationId: organization.id,
        userId,
        groupId: null,
        apiKeyId: null,
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: `team_${ns}`,
      });

      // The cursor is the commit marker: it advances only once everything it
      // describes is in place.
      const cursor = await prisma.authzProjectionCursor.findUnique({
        where: { organizationId: organization.id },
      });
      expect(cursor?.projectionVersion).toBe(projection.version);
    });
  });

  describe("when a role is defined and a grant carries it", () => {
    /** @scenario "A live grant write lands both projected heads through the real fold" */
    it("lands both role heads, and the binding that references the compat one", async () => {
      const roleId = `role_${ns}`;
      const bindingId = `rb_${ns}_custom`;

      await writer().defineRole({
        organizationId: organization.id,
        roleId,
        name: `Auditor ${ns}`,
        permissions: ["traces:view"],
        kind: "custom",
        actor: { type: "user", id: userId },
      });
      await writer().attachBindings({
        organizationId: organization.id,
        bindings: [
          {
            bindingId,
            principal: { userId },
            role: TeamUserRole.CUSTOM,
            customRoleId: roleId,
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: `project_${ns}`,
          },
        ],
        actor: { type: "user", id: userId },
        onDuplicate: "reject",
      });

      expect(
        await prisma.role.findFirst({
          where: { organizationId: organization.id, id: roleId },
        }),
      ).toMatchObject({ name: `Auditor ${ns}`, kind: "custom" });
      expect(
        await prisma.customRole.findFirst({
          where: { organizationId: organization.id, id: roleId },
        }),
      ).toMatchObject({ name: `Auditor ${ns}`, kind: "custom" });

      // The roleKey → (role, customRoleId) translation is the compat head's
      // whole job, and this is the arm with a foreign key riding on it: the
      // role's compat row has to be written before the binding naming it.
      expect(
        await prisma.roleBinding.findFirst({
          where: { organizationId: organization.id, id: bindingId },
        }),
      ).toMatchObject({
        role: TeamUserRole.CUSTOM,
        customRoleId: roleId,
        scopeType: RoleBindingScopeType.PROJECT,
      });
      expect(
        await prisma.grant.findFirst({
          where: { organizationId: organization.id, id: bindingId },
        }),
      ).toMatchObject({ roleKey: `custom:${roleId}` });
    });
  });

  /**
   * `grantFactToCompatBinding` answers null for every fact the legacy tables
   * cannot express, and `lite-member` is one of them — an organization-level
   * seat `RoleBinding.role` has no name for. The fold still has to land the
   * future head, and must not read "no compat row" as a failure: a throw here
   * escapes before `writeCursor` and parks the organization's whole lane.
   */
  describe("when a fact the legacy tables cannot express is folded", () => {
    /** @scenario "A live grant write lands both projected heads through the real fold" */
    it("lands the grant head alone, and still advances the cursor", async () => {
      const grantId = `grant_${ns}_lite`;

      await expect(
        sendAttachGrants({
          tenantId: organization.id,
          organizationId: organization.id,
          commandId: `cmd_${ns}_lite`,
          grants: [
            {
              grantId,
              principal: { type: "user", id: userId },
              roleKey: "lite-member",
              scope: { type: "ORGANIZATION", id: organization.id },
              source: "genesis-import",
              actor: { type: "user", id: userId },
              occurredAtMs: 1_700_000_000_000,
            },
          ],
        }),
      ).resolves.toBeUndefined();

      expect(
        await prisma.grant.findFirst({
          where: { organizationId: organization.id, id: grantId },
        }),
      ).toMatchObject({ roleKey: "lite-member", scopeType: "ORGANIZATION" });
      expect(
        await prisma.roleBinding.findFirst({
          where: { organizationId: organization.id, id: grantId },
        }),
      ).toBeNull();
      expect(
        await prisma.authzProjectionCursor.count({
          where: { organizationId: organization.id },
        }),
      ).toBe(1);
    });
  });
});
