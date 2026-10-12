/**
 * @vitest-environment node
 *
 * ADR-144 block B: a revoked shared grant is absent from the next proof.
 * Real Postgres, the real engine and collector, the real shared-reads
 * repository; only the ledger queue is stubbed, because revocation marks
 * the row synchronously and that mark is what the next mint reads.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { AuthzCollectorService, AuthzService } from "@langwatch/authz-server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  OrganizationUserRole,
  type Project,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { AuthorizationService } from "../authorization.service";
import { type AuthzGrantsCommandSenders, GrantsLedgerWriter } from "../ledger";
import { GrantsAuthzReadRepository } from "../repositories/authz-read.grants.repository";
import { SharedReadsGrantsRepository } from "../repositories/shared-reads.grants.repository";

const ns = `authz-proof-${nanoid(8)}`;
const COMMAND_VERBS = [
  "attachGrant",
  "changeGrantRole",
  "revokeGrant",
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
] as const;

describe("given an aggregate project with one member and an admin", () => {
  let organization: Organization;
  let aggregate: Project;
  let member: Project;
  let anaId: string;
  let sharedGrantId: string;

  const door = () => {
    const collector = new AuthzCollectorService(
      new GrantsAuthzReadRepository(prisma),
    );
    return new AuthorizationService({
      authz: new AuthzService(collector),
      collector,
      sharedReads: new SharedReadsGrantsRepository(prisma),
    });
  };

  const mint = () =>
    door().authorize({
      actor: { type: "user", id: anaId },
      principal: { type: "user", id: anaId },
      permission: "traces:view",
      scope: { projectId: aggregate.id },
      purpose: { kind: "route", route: "traces.list" },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Proof Org", slug: `--test-org-${ns}` },
    });
    const team = await prisma.team.create({
      data: {
        name: "Leadership",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    const project = (suffix: string) =>
      prisma.project.create({
        data: {
          name: `Project ${suffix}`,
          slug: `--test-project-${ns}-${suffix}`,
          apiKey: `sk-lw-test-${nanoid()}`,
          teamId: team.id,
          language: "en",
          framework: "test",
        },
      });
    aggregate = await project("aggregate");
    member = await project("member");

    const ana = await prisma.user.create({
      data: { name: "Ana", email: `${ns}@example.com` },
    });
    anaId = ana.id;
    await prisma.organizationUser.create({
      data: {
        userId: anaId,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.grant.create({
      data: {
        id: `grant_${ns}_ana_admin`,
        organizationId: organization.id,
        principalType: GrantPrincipalType.USER,
        principalId: anaId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: GrantScopeType.ORGANIZATION,
        scopeId: organization.id,
        occurredAt: new Date(),
      },
    });
    sharedGrantId = `grant_${ns}_shared`;
    await prisma.grant.create({
      data: {
        id: sharedGrantId,
        organizationId: organization.id,
        principalType: GrantPrincipalType.PROJECT,
        principalId: aggregate.id,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: GrantScopeType.PROJECT,
        scopeId: member.id,
        condition: { type: "trace", from: "2026-10-01T00:00:00.000Z" },
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (!organization?.id) return;
    await cleanupTestRows(prisma, [
      ["grant", { organizationId: organization.id }],
      ["organizationUser", { organizationId: organization.id }],
      ["project", { id: { in: [aggregate.id, member.id] } }],
      ["team", { organizationId: organization.id }],
      ...(anaId ? ([["user", { id: anaId }]] as const) : []),
      ["organization", { id: organization.id }],
    ]);
  });

  /** @scenario "A revoked grant is absent from the next proof" */
  it("lists the member while the grant is live and drops it once revoked", async () => {
    const before = await mint();
    expect(before.grants.map((grant) => [grant.kind, grant.projectId])).toEqual(
      [
        ["own", aggregate.id],
        ["shared", member.id],
      ],
    );
    expect(before.grants[1]?.via).toEqual([sharedGrantId]);

    const writer = new GrantsLedgerWriter(prisma, {
      commands: async () => ({
        commands: Object.fromEntries(
          COMMAND_VERBS.map((verb) => [verb, { send: async () => undefined }]),
        ) as unknown as AuthzGrantsCommandSenders,
      }),
    });
    await writer.revokeSharedProjectGrants({
      organizationId: organization.id,
      readerProjectId: aggregate.id,
      memberProjectIds: [member.id],
      actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
      reason: "rule-narrowed",
    });

    const after = await mint();
    expect(after.grants.map((grant) => [grant.kind, grant.projectId])).toEqual([
      ["own", aggregate.id],
    ]);
  });
});
