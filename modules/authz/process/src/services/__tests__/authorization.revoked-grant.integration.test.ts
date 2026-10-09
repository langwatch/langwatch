/**
 * @vitest-environment node
 * ADR-177 block B: a revoked shared grant is absent from the next proof. Real Postgres, engine,
 * collector and shared-reads repository; only the command dispatcher is recorded, because the
 * revocation marks the row synchronously and that mark is what the next mint reads.
 * @see specs/governance/aggregate-project.feature
 */
import { randomUUID } from "node:crypto";

import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EventingAuthzLedgerAdapter } from "../../eventing/authz-grant.store.ts";
import { StubAuthzEpoch } from "../../repositories/__tests__/support/authz-epoch.stub.ts";
import { EventingAuthzListingRepository } from "../../repositories/eventing/eventing.authz-listing.repository.ts";
import { EventingAuthzReadRepository } from "../../repositories/eventing/eventing.authz-read.repository.ts";
import { PrismaAuthzLedgerReadRepository } from "../../repositories/prisma/prisma.authz-ledger-read.repository.ts";
import { PrismaAuthzManagedGrantRepository } from "../../repositories/prisma/prisma.authz-managed-grant.repository.ts";
import { PrismaAuthzMembershipStampRepository } from "../../repositories/prisma/prisma.authz-membership-stamp.repository.ts";
import { PrismaAuthzRevocationRepository } from "../../repositories/prisma/prisma.authz-revocation.repository.ts";
import { AuthorizationService } from "../authorization.service.ts";
import { AuthzCollectorService } from "../authz-collector.service.ts";
import { AuthzGrantsCommandDispatcher } from "../authz-grants-command-dispatcher.service.ts";
import { AuthzService } from "../authz.service.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;

class DiscardingDispatcher extends AuthzGrantsCommandDispatcher {
  async commands() {
    const discard = { send: async () => undefined };
    return {
      commands: {
        attachGrant: discard,
        changeGrantRole: discard,
        revokeGrant: discard,
        defineRole: discard,
        changeRolePermissions: discard,
        deleteRole: discard,
      },
    };
  }
}

describe.skipIf(!DB_URL)("given an aggregate project with one member and an admin", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const ns = `authz-proof-${randomUUID().slice(0, 8)}`;
  let organizationId = "";
  let aggregateId = "";
  let memberId = "";
  let anaId = "";
  let sharedGrantId = "";

  const door = () => {
    const reader = EventingAuthzReadRepository.create(prisma);
    const collector = AuthzCollectorService.create({ reader });
    return AuthorizationService.create({
      authz: AuthzService.create({
        repository: reader,
        listing: EventingAuthzListingRepository.create(prisma),
        bindings: PrismaAuthzManagedGrantRepository.create({ database: prisma }),
        isOnEngine: async () => true,
      }),
      collector,
      sharedReads: reader,
    });
  };

  const mint = () =>
    door().authorize({
      actor: { type: "user", id: anaId },
      principal: { type: "user", id: anaId },
      permission: "traces:view",
      scope: { projectId: aggregateId },
      purpose: { kind: "route", route: "traces.list" },
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Proof Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "Leadership", slug: `--test-team-${ns}`, organizationId },
    });
    const project = async (suffix: string) =>
      (
        await prisma.project.create({
          data: {
            name: `Project ${suffix}`,
            slug: `--test-project-${ns}-${suffix}`,
            apiKey: `sk-lw-test-${ns}-${suffix}`,
            teamId: team.id,
            language: "en",
            framework: "test",
          },
        })
      ).id;
    aggregateId = await project("aggregate");
    memberId = await project("member");

    const ana = await prisma.user.create({ data: { name: "Ana", email: `${ns}@example.com` } });
    anaId = ana.id;
    await prisma.organizationUser.create({
      data: { userId: anaId, organizationId, role: "ADMIN" },
    });
    await prisma.grant.create({
      data: {
        id: `grant_${ns}_ana_admin`,
        organizationId,
        principalType: "USER",
        principalId: anaId,
        roleKey: "admin",
        source: "grants-service",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        occurredAt: new Date(),
      },
    });
    sharedGrantId = `grant_${ns}_shared`;
    await prisma.grant.create({
      data: {
        id: sharedGrantId,
        organizationId,
        principalType: "PROJECT",
        principalId: aggregateId,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: "PROJECT",
        scopeId: memberId,
        condition: { type: "trace", from: "2026-10-01T00:00:00.000Z" },
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (organizationId) {
      await cleanupTestRows(prisma, [
        ["grant", { organizationId }],
        ["organizationUser", { organizationId }],
        ["project", { team: { organizationId } }],
        ["team", { organizationId }],
        ["user", { id: anaId }],
        ["organization", { id: organizationId }],
      ]);
    }
    await prisma.$disconnect();
  });

  /** @scenario "A revoked grant is absent from the next proof" */
  it("lists the member while the grant is live and drops it once revoked", async () => {
    const before = await mint();
    expect(before.grants.map((grant) => [grant.kind, grant.projectId])).toEqual([
      ["own", aggregateId],
      ["shared", memberId],
    ]);
    expect(before.grants[1]?.via).toEqual([sharedGrantId]);

    await EventingAuthzLedgerAdapter.create({
      reads: PrismaAuthzLedgerReadRepository.create({ prisma }),
      lineage: EventingAuthzReadRepository.create(prisma),
      dispatcher: new DiscardingDispatcher(),
      epoch: new StubAuthzEpoch(),
      revocation: PrismaAuthzRevocationRepository.create({ database: prisma }),
      membershipStamps: PrismaAuthzMembershipStampRepository.create({ database: prisma }),
    }).revokeSharedProjectGrants({
      organizationId,
      readerProjectId: aggregateId,
      memberProjectIds: [memberId],
      actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
      reason: "rule-narrowed",
    });

    const after = await mint();
    expect(after.grants.map((grant) => [grant.kind, grant.projectId])).toEqual([
      ["own", aggregateId],
    ]);
  });
});
