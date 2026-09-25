/** @vitest-environment node */

import type { LedgerActor } from "@langwatch/actor";
import { type GrantFact, grantFactToRow } from "@langwatch/authz-server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import type { AttachGrantCommandData } from "../../../event-sourcing/pipelines/authz-grants/schemas/commands";
import { AuthzEngineMigration } from "../authz-engine.migration";
import { type AuthzGrantsCommandSenders, GrantsLedgerWriter } from "../ledger";
import { LedgerAuthzGrantsRepository } from "../repositories/authz-grants.ledger.repository";
import { PrismaAuthzGrantsWriteRepository } from "../repositories/authz-grants-write.prisma.repository";
import { PrismaAuthzMigrationRepository } from "../repositories/authz-migration.prisma.repository";

const suffix = nanoid(8);
const organizationId = `org-membership-stamp-${suffix}`;
const memberId = `user-membership-stamp-${suffix}`;
const adminId = `user-membership-stamp-admin-${suffix}`;
const actor: LedgerActor = { type: "user", id: adminId };

type MigrationLedger = ConstructorParameters<
  typeof AuthzEngineMigration
>[0]["ledger"];

const noProjectionCommands = (): AuthzGrantsCommandSenders => ({
  attachGrant: { send: async () => undefined },
  changeGrantRole: { send: async () => undefined },
  revokeGrant: { send: async () => undefined },
  defineRole: { send: async () => undefined },
  changeRolePermissions: { send: async () => undefined },
  deleteRole: { send: async () => undefined },
});

beforeAll(async () => {
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Membership stamp",
      slug: organizationId,
    },
  });
  await prisma.user.createMany({
    data: [
      { id: memberId, email: `${memberId}@example.com` },
      { id: adminId, email: `${adminId}@example.com` },
    ],
  });
  await prisma.organizationUser.createMany({
    data: [
      { userId: memberId, organizationId, role: OrganizationUserRole.MEMBER },
      { userId: adminId, organizationId, role: OrganizationUserRole.ADMIN },
    ],
  });
});

beforeEach(async () => {
  await prisma.roleBinding.deleteMany({ where: { organizationId } });
  await prisma.grant.deleteMany({ where: { organizationId } });
  await prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId: memberId, organizationId } },
    create: {
      userId: memberId,
      organizationId,
      role: OrganizationUserRole.MEMBER,
    },
    update: {
      role: OrganizationUserRole.MEMBER,
      disabledAt: null,
    },
  });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["grant", { organizationId }],
    ["roleBinding", { organizationId }],
    ["organizationUser", { organizationId }],
    ["organization", { id: organizationId }],
    ["user", { id: { in: [memberId, adminId] } }],
  ]);
});

describe("membership stamp fence", () => {
  /** @scenario "A delayed live attach is rejected after offboarding" */
  it("rejects a delayed attach after offboard and rejoin", async () => {
    const initialMembership = await prisma.organizationUser.findUniqueOrThrow({
      where: { userId_organizationId: { userId: memberId, organizationId } },
      select: { membershipStamp: true },
    });
    const captured: AttachGrantCommandData["grant"][] = [];
    const attachWriter = new GrantsLedgerWriter(prisma, {
      commands: async () => ({
        commands: {
          ...noProjectionCommands(),
          attachGrant: {
            send: async (data) => {
              captured.push(data.grant);
            },
          },
        },
      }),
    });

    await attachWriter.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: `grant-delayed-${suffix}`,
          principal: { userId: memberId },
          role: TeamUserRole.MEMBER,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      ],
      actor,
      onDuplicate: "skip",
      awaitProjection: false,
    });
    expect(captured).toHaveLength(1);
    const delayedGrant = captured[0]!;

    const offboardWriter = new GrantsLedgerWriter(prisma, {
      commands: async () => ({ commands: noProjectionCommands() }),
    });
    const repository = new LedgerAuthzGrantsRepository(prisma, offboardWriter);
    await repository.offboardUser({
      userId: memberId,
      organizationId,
      actor,
      prove: async () => undefined,
    });

    const rejoined = await prisma.organizationUser.create({
      data: {
        userId: memberId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
      select: { membershipStamp: true },
    });
    expect(rejoined.membershipStamp).not.toBe(
      initialMembership.membershipStamp,
    );

    const staleFact: GrantFact = delayedGrant;
    const writeStore = new PrismaAuthzGrantsWriteRepository(prisma);
    await writeStore.append({
      kind: "grant.upsert",
      row: grantFactToRow({ organizationId, grant: staleFact }),
      membershipStamp: initialMembership.membershipStamp,
    });
    expect(
      await prisma.grant.count({
        where: { id: staleFact.grantId, organizationId },
      }),
    ).toBe(0);

    await writeStore.append({
      kind: "grant.upsert",
      row: grantFactToRow({ organizationId, grant: staleFact }),
      membershipStamp: rejoined.membershipStamp,
    });
    expect(
      await prisma.grant.count({
        where: { id: staleFact.grantId, organizationId },
      }),
    ).toBe(1);
  });

  /** @scenario "A delayed migration attach cannot cross a membership lifetime" */
  it("fences a held direct migration command across offboard and rejoin", async () => {
    const bindingId = `binding-migration-${suffix}`;
    await prisma.roleBinding.create({
      data: {
        id: bindingId,
        organizationId,
        userId: memberId,
        groupId: null,
        apiKeyId: null,
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
    const initialMembership = await prisma.organizationUser.findUniqueOrThrow({
      where: { userId_organizationId: { userId: memberId, organizationId } },
      select: { membershipStamp: true },
    });
    const captured: GrantFact[] = [];
    const migrationLedger: MigrationLedger = {
      attachGrant: async ({ grant }) => {
        captured.push(grant);
      },
      defineRole: async () => undefined,
      changeGrantRole: async () => undefined,
      revokeGrant: async () => undefined,
      deleteRole: async () => undefined,
    };
    const migration = new AuthzEngineMigration({
      store: new PrismaAuthzMigrationRepository(prisma),
      ledger: migrationLedger,
      now: () => Date.now(),
    });

    await migration.migrateTenant({ tenantId: organizationId });

    const delayedGrant = captured.find(
      (grant) => grant.principal.type === "user" && grant.grantId === bindingId,
    );
    if (delayedGrant === undefined) {
      throw new Error("migration did not emit the legacy USER binding");
    }
    expect(delayedGrant).toMatchObject({
      principal: { type: "user", id: memberId },
      membershipStamp: initialMembership.membershipStamp,
    });

    const offboardWriter = new GrantsLedgerWriter(prisma, {
      commands: async () => ({ commands: noProjectionCommands() }),
    });
    const repository = new LedgerAuthzGrantsRepository(prisma, offboardWriter);
    await repository.offboardUser({
      userId: memberId,
      organizationId,
      actor,
      prove: async () => undefined,
    });
    expect(await prisma.roleBinding.count({ where: { id: bindingId } })).toBe(
      0,
    );

    const rejoined = await prisma.organizationUser.create({
      data: {
        userId: memberId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
      select: { membershipStamp: true },
    });
    expect(rejoined.membershipStamp).not.toBe(
      initialMembership.membershipStamp,
    );

    const writeStore = new PrismaAuthzGrantsWriteRepository(prisma);
    await writeStore.append({
      kind: "grant.upsert",
      row: grantFactToRow({
        organizationId,
        grant: delayedGrant,
      }),
      membershipStamp: initialMembership.membershipStamp,
    });
    expect(
      await prisma.grant.count({ where: { id: bindingId, organizationId } }),
    ).toBe(0);
  });

  /** @scenario "A disabled membership keeps its migration lifetime" */
  it("replays disabled USER migration facts and ignores stamps on non-user facts", async () => {
    const bindingId = `binding-disabled-${suffix}`;
    await prisma.organizationUser.update({
      where: { userId_organizationId: { userId: memberId, organizationId } },
      data: { disabledAt: new Date() },
    });
    await prisma.roleBinding.create({
      data: {
        id: bindingId,
        organizationId,
        userId: memberId,
        groupId: null,
        apiKeyId: null,
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
    const membership = await prisma.organizationUser.findUniqueOrThrow({
      where: { userId_organizationId: { userId: memberId, organizationId } },
      select: { membershipStamp: true },
    });
    const captured: GrantFact[] = [];
    const migrationLedger: MigrationLedger = {
      attachGrant: async ({ grant }) => {
        captured.push(grant);
      },
      defineRole: async () => undefined,
      changeGrantRole: async () => undefined,
      revokeGrant: async () => undefined,
      deleteRole: async () => undefined,
    };
    await new AuthzEngineMigration({
      store: new PrismaAuthzMigrationRepository(prisma),
      ledger: migrationLedger,
      now: () => Date.now(),
    }).migrateTenant({ tenantId: organizationId });

    const userGrant = captured.find((grant) => grant.grantId === bindingId);
    if (userGrant === undefined) {
      throw new Error("migration did not emit the disabled USER binding");
    }
    expect(userGrant).toMatchObject({
      principal: { type: "user", id: memberId },
      membershipStamp: membership.membershipStamp,
    });
    const writeStore = new PrismaAuthzGrantsWriteRepository(prisma);
    await writeStore.append({
      kind: "grant.upsert",
      row: grantFactToRow({
        organizationId,
        grant: userGrant,
      }),
      membershipStamp: membership.membershipStamp,
    });
    expect(
      await prisma.grant.count({ where: { id: bindingId, organizationId } }),
    ).toBe(1);

    const nonUserGrants: GrantFact[] = [
      {
        grantId: `grant-group-${suffix}`,
        principal: { type: "group", id: `group-${suffix}` },
        roleKey: "member",
        scope: { type: "ORGANIZATION", id: organizationId },
        source: "migration",
        occurredAtMs: Date.now(),
      },
      {
        grantId: `grant-api-key-${suffix}`,
        principal: { type: "apiKey", id: `api-key-${suffix}` },
        roleKey: "member",
        scope: { type: "ORGANIZATION", id: organizationId },
        source: "migration",
        occurredAtMs: Date.now(),
      },
    ];
    for (const grant of nonUserGrants) {
      await writeStore.append({
        kind: "grant.upsert",
        row: grantFactToRow({ organizationId, grant }),
        membershipStamp: "not-a-user-membership",
      });
    }
    expect(
      await prisma.grant.count({
        where: {
          id: { in: nonUserGrants.map((grant) => grant.grantId) },
          organizationId,
        },
      }),
    ).toBe(nonUserGrants.length);
  });
});
