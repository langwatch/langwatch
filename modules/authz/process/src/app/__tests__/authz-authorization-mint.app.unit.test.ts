/**
 * ADR-175 block B: a revoked shared grant is absent from the next proof. The composed app over one
 * memory tier; only the command queue is stubbed, as revocation marks the row synchronously.
 * @see specs/governance/aggregate-project.feature
 */
import { isSealedAuthorization, SYSTEM_ACTORS } from "@langwatch/authorization";
import { createTenantId } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { EventingAuthzLedgerAdapter } from "../../eventing/authz-grant.store.ts";
import type { AuthzRepositories } from "../../repositories/authz.repositories.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../../repositories/memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "../../repositories/memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "../../repositories/memory/memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzReadRepository } from "../../repositories/memory/memory.authz-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "../../repositories/memory/memory.authz-revocation.repository.ts";
import { MemoryAuthzSharedReadRepository } from "../../repositories/memory/memory.authz-shared-read.repository.ts";
import {
  MemoryAuthzEpochRepository,
  MemoryAuthzRepositories,
} from "../../repositories/memory/memory.authz.repositories.ts";
import type { GrantRowShape } from "../../repositories/prisma/prisma.authz-grant.mapper.ts";
import { AuthzCommandDispatcherService } from "../../services/authz-grants-command-dispatcher.service.ts";
import { AuthzModule, type AuthzSetup } from "../authz.app.ts";

const ORG = "org_proof";
const TEAM = "team_leadership";
const AGGREGATE = "proj_aggregate";
const MEMBER = "proj_member";
const ANA = "user_ana";
const SHARED_GRANT = "grant_shared";
const T0 = Temporal.Instant.from("2026-10-01T00:00:00Z");
const CONTEXT = { aggregateId: "grant", tenantId: createTenantId(ORG) };

/** Every repository the mint and the ledger touch, over the one memory tier the test seeds. */
function repositoriesOver(memory: AuthzMemoryStore): AuthzRepositories {
  return {
    ...MemoryAuthzRepositories.create(),
    epoch: MemoryAuthzEpochRepository.create({ memory }),
    read: MemoryAuthzReadRepository.create({ memory }),
    sharedReads: MemoryAuthzSharedReadRepository.create({ memory }),
    grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
    revocation: MemoryAuthzRevocationRepository.create({ memory }),
    ledgerReads: MemoryAuthzLedgerReadRepository.create({ memory }),
    membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
  };
}

function grantRow(row: Partial<GrantRowShape> & Pick<GrantRowShape, "id">): GrantRowShape {
  return {
    organizationId: ORG,
    principalType: "USER",
    principalId: ANA,
    roleKey: "admin",
    legacyRole: null,
    source: "grants-service",
    scopeType: "ORGANIZATION",
    scopeId: ORG,
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: T0,
    ...row,
  };
}

/** An organisation admin, an aggregate project and one member it reads through a shared grant. */
async function seed(repositories: AuthzRepositories, memory: AuthzMemoryStore): Promise<void> {
  memory.teams.push({
    id: TEAM,
    organizationId: ORG,
    name: "Leadership",
    isPersonal: false,
    ownerUserId: null,
  });
  for (const id of [AGGREGATE, MEMBER]) {
    memory.projects.push({
      id,
      teamId: TEAM,
      name: id,
      isPersonal: false,
      apiKey: `sk-lw-${id}`,
      createdAt: T0,
    });
  }
  memory.memberships.set(memory.membershipKey(ORG, ANA), {
    role: "ADMIN",
    disabled: false,
    membershipStamp: "stamp_ana",
    pendingSsoGrantId: null,
    createdAt: T0,
  });
  for (const row of [
    grantRow({ id: "grant_ana_admin" }),
    grantRow({
      id: SHARED_GRANT,
      principalType: "PROJECT",
      principalId: AGGREGATE,
      roleKey: "project-reader",
      source: "aggregate-reconciler",
      scopeType: "PROJECT",
      scopeId: MEMBER,
      condition: { type: "trace", from: "2026-10-01T00:00:00.000Z" },
    }),
  ]) {
    await repositories.grantProjection.append({ kind: "grant.upsert", row }, CONTEXT);
  }
}

/** The ledger over the same rows, its command queue answering every send at once. */
function ledgerOver(repositories: AuthzRepositories): EventingAuthzLedgerAdapter {
  const dispatcher = AuthzCommandDispatcherService.create();
  const accept = { send: async () => void 0 };
  dispatcher.connect(
    AuthzCommandDispatcherService.sendersFrom({
      attachGrant: accept,
      changeGrantRole: accept,
      revokeGrant: accept,
      defineRole: accept,
      changeRolePermissions: accept,
      deleteRole: accept,
    }),
  );
  return EventingAuthzLedgerAdapter.create({
    reads: repositories.ledgerReads,
    dispatcher,
    epoch: repositories.epoch,
    revocation: repositories.revocation,
    membershipStamps: repositories.membershipStamps,
    sharedReads: repositories.sharedReads,
    lineage: repositories.read,
  });
}

function composeOver(repositories: AuthzRepositories): AuthzModule {
  return AuthzModule.create({
    dependencies: {},
    config: {
      epochCacheEnabled: true,
      demoProjectId: undefined,
      demoProjectUserId: undefined,
      demoProjectSlug: undefined,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<AuthzSetup["secrets"]>(),
    repositories,
  });
}

describe("given an aggregate project with one member and an admin", () => {
  /** @scenario "A revoked grant is absent from the next proof" */
  it("lists the member while the grant is live and drops it once revoked", async () => {
    const memory = AuthzMemoryStore.create();
    const repositories = repositoriesOver(memory);
    await seed(repositories, memory);
    const app = composeOver(repositories);
    const mint = () =>
      app.mintAuthorization({
        actor: { type: "user", id: ANA },
        principal: { type: "user", id: ANA },
        permission: "traces:view",
        scope: { projectId: AGGREGATE },
        purpose: { kind: "route", route: "traces.list" },
      });

    const before = await mint();
    expect(isSealedAuthorization(before)).toBe(true);
    expect(before.grants.map((grant) => [grant.kind, grant.projectId])).toEqual([
      ["own", AGGREGATE],
      ["shared", MEMBER],
    ]);
    expect(before.grants[1]?.via).toEqual([SHARED_GRANT]);

    await ledgerOver(repositories).revokeSharedProjectGrants({
      organizationId: ORG,
      readerProjectId: AGGREGATE,
      memberProjectIds: [MEMBER],
      actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
      reason: "rule-narrowed",
    });

    const after = await mint();
    expect(after.grants.map((grant) => [grant.kind, grant.projectId])).toEqual([
      ["own", AGGREGATE],
    ]);
  });
});
