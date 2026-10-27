/**
 * @vitest-environment node
 * ADR-177 block A: a shared project read lives and dies as a ledger fact. Real Postgres and Redis:
 * the promise is that the row is marked rather than deleted and that the epoch moves.
 * @see specs/governance/aggregate-project.feature
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { cleanupTestRows, documentedDownPath } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EventingAuthzLedgerAdapter } from "../../eventing/authz-grant.store.ts";
import { EventingAuthzReadRepository } from "../../repositories/eventing/eventing.authz-read.repository.ts";
import { grantFactToRow } from "../../repositories/prisma/prisma.authz-grant.mapper.ts";
import { PrismaAuthzLedgerReadRepository } from "../../repositories/prisma/prisma.authz-ledger-read.repository.ts";
import { PrismaAuthzMembershipStampRepository } from "../../repositories/prisma/prisma.authz-membership-stamp.repository.ts";
import { PrismaAuthzProjectionRepository } from "../../repositories/prisma/prisma.authz-projection.repository.ts";
import { PrismaAuthzRevocationRepository } from "../../repositories/prisma/prisma.authz-revocation.repository.ts";
import { RedisAuthzEpochRepository } from "../../repositories/redis/redis.authz-epoch.repository.ts";
import { AuthzGrantsCommandDispatcher } from "../authz-grants-command-dispatcher.service.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;
const REDIS_URL = process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL;

const CONDITION = { type: "trace", from: "2026-10-01T00:00:00.000Z" } as const;
const GRANT_CONDITION_MIGRATION = "20261006120001_grant_condition";
const ACTOR = { type: "system" as const, id: SYSTEM_ACTORS.aggregateReconciler };

type Sent = { verb: string; data: unknown };

class RecordingDispatcher extends AuthzGrantsCommandDispatcher {
  constructor(private readonly sent: Sent[]) {
    super();
  }

  async commands() {
    const record = (verb: string) => ({
      send: async (data: unknown) => {
        this.sent.push({ verb, data });
      },
    });
    return {
      commands: {
        attachGrant: record("attachGrant"),
        changeGrantRole: record("changeGrantRole"),
        revokeGrant: record("revokeGrant"),
        defineRole: record("defineRole"),
        changeRolePermissions: record("changeRolePermissions"),
        deleteRole: record("deleteRole"),
      },
    };
  }
}

describe.skipIf(!DB_URL || !REDIS_URL)("given a shared project read in the ledger", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const ns = `authz-shared-read-${randomUUID().slice(0, 8)}`;
  const appended: Sent[] = [];
  let redis: RedisConnection | null = null;
  let organizationId = "";
  let foreignOrganizationId = "";
  let teamId = "";
  let readerId = "";
  let memberId = "";
  let foreignId = "";
  let sharedGrantId = "";
  let projectedGrantId = "";

  const epoch = () => RedisAuthzEpochRepository.create({ redis });
  const writer = ({ now }: { now?: () => number } = {}) =>
    EventingAuthzLedgerAdapter.create({
      reads: PrismaAuthzLedgerReadRepository.create({ prisma }),
      lineage: EventingAuthzReadRepository.create(prisma),
      dispatcher: new RecordingDispatcher(appended),
      epoch: epoch(),
      revocation: PrismaAuthzRevocationRepository.create({ database: prisma }),
      membershipStamps: PrismaAuthzMembershipStampRepository.create({ database: prisma }),
      poll: { intervalMs: 0, timeoutMs: 0 },
      ...(now ? { now } : {}),
    });

  async function project({ team, suffix }: { team: string; suffix: string }): Promise<string> {
    const created = await prisma.project.create({
      data: {
        name: `Project ${suffix}`,
        slug: `--test-project-${ns}-${suffix}`,
        apiKey: `sk-lw-test-${ns}-${suffix}`,
        teamId: team,
        language: "en",
        framework: "test",
      },
    });
    return created.id;
  }

  async function sharedRow({
    id,
    scopeId,
    occurredAt = new Date(),
    revokedAt,
    condition = CONDITION,
  }: {
    id: string;
    scopeId: string;
    occurredAt?: Date;
    revokedAt?: Date;
    condition?: Record<string, string>;
  }) {
    await prisma.grant.create({
      data: {
        id,
        organizationId,
        principalType: "PROJECT",
        principalId: readerId,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: "PROJECT",
        scopeId,
        condition,
        occurredAt,
        ...(revokedAt ? { revokedAt, revokedReason: "aggregate_rule_no_longer_matches" } : {}),
      },
    });
  }

  beforeAll(async () => {
    redis = new RedisConnectionService().connect({
      url: REDIS_URL,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    });
    const organization = await prisma.organization.create({
      data: { name: "Shared Read Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "Team", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    readerId = await project({ team: teamId, suffix: "aggregate" });
    memberId = await project({ team: teamId, suffix: "member" });

    const foreignOrganization = await prisma.organization.create({
      data: { name: "Foreign Org", slug: `--test-org-${ns}-foreign` },
    });
    foreignOrganizationId = foreignOrganization.id;
    const foreignTeam = await prisma.team.create({
      data: {
        name: "Foreign Team",
        slug: `--test-team-${ns}-foreign`,
        organizationId: foreignOrganizationId,
      },
    });
    foreignId = await project({ team: foreignTeam.id, suffix: "foreign" });

    // The row a landed fold leaves behind for one shared read.
    sharedGrantId = `grant_${ns}_shared`;
    await sharedRow({ id: sharedGrantId, scopeId: memberId });
  });

  afterAll(async () => {
    await redis?.quit();
    if (organizationId) {
      await cleanupTestRows(prisma, [
        ["grant", { organizationId }],
        ["project", { team: { organizationId: { in: [organizationId, foreignOrganizationId] } } }],
        ["team", { organizationId: { in: [organizationId, foreignOrganizationId] } }],
        ["organization", { id: { in: [organizationId, foreignOrganizationId] } }],
      ]);
    }
    await prisma.$disconnect();
  });

  /** @scenario "Only the project-reader shape lifts the foreign-project refusal" */
  it("refuses a shared read on a project in another organisation against real lineage", async () => {
    await expect(
      writer().attachSharedProjectGrant({
        organizationId,
        readerProjectId: readerId,
        memberProjectId: foreignId,
        condition: CONDITION,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: "grant_validation_failed" });
    expect(appended).toHaveLength(0);
  });

  it("returns the live shared read as it stands instead of emitting it again", async () => {
    const outcome = await writer().attachSharedProjectGrant({
      organizationId,
      readerProjectId: readerId,
      memberProjectId: memberId,
      condition: CONDITION,
      actor: ACTOR,
    });
    expect(outcome).toEqual({ grantId: sharedGrantId, wasAttached: false });
    expect(appended).toHaveLength(0);
  });

  it("gives a pair revoked earlier in the same second a fresh id rather than the revoked row's", async () => {
    const frozenMs = Date.UTC(2026, 9, 7, 10, 0, 0, 400);
    const sameSecondMember = await project({ team: teamId, suffix: "same-second" });
    const revokedSameSecond = `grant_${ns}_revoked_same_second`;
    await sharedRow({
      id: revokedSameSecond,
      scopeId: sameSecondMember,
      occurredAt: new Date(frozenMs),
      revokedAt: new Date(frozenMs),
    });
    const sent = appended.length;

    try {
      const outcome = await writer({ now: () => frozenMs }).attachSharedProjectGrant({
        organizationId,
        readerProjectId: readerId,
        memberProjectId: sameSecondMember,
        condition: CONDITION,
        actor: ACTOR,
        awaitProjection: false,
      });

      expect(outcome.wasAttached).toBe(true);
      expect(outcome.grantId).not.toBe(revokedSameSecond);
      expect(appended[sent]).toMatchObject({
        verb: "attachGrant",
        data: { grant: { grantId: outcome.grantId, condition: CONDITION } },
      });
    } finally {
      appended.splice(sent);
      await prisma.grant.deleteMany({ where: { id: revokedSameSecond, organizationId } });
      await prisma.project.deleteMany({ where: { id: sameSecondMember } });
    }
  });

  it("lands a shared read through the projection's raw upsert with its condition and no legacy head", async () => {
    projectedGrantId = `grant_${ns}_projected`;
    await PrismaAuthzProjectionRepository.create(prisma).append({
      kind: "grant.upsert",
      row: grantFactToRow({
        organizationId,
        grant: {
          grantId: projectedGrantId,
          principal: { type: "project", id: readerId },
          roleKey: "project-reader",
          scope: { type: "PROJECT", id: memberId },
          condition: CONDITION,
          source: "aggregate-reconciler",
          occurredAtMs: Date.now(),
        },
      }),
    });

    await expect(
      prisma.grant.findUnique({
        where: { id: projectedGrantId },
        select: { condition: true, roleKey: true, principalType: true },
      }),
    ).resolves.toEqual({
      condition: CONDITION,
      roleKey: "project-reader",
      principalType: "PROJECT",
    });
    // A shared read is neither a membership nor a share link: the legacy heads stay silent.
    await expect(
      prisma.roleBinding.findUnique({ where: { id: projectedGrantId } }),
    ).resolves.toBeNull();
    await expect(
      prisma.shareLink.findUnique({ where: { id: projectedGrantId } }),
    ).resolves.toBeNull();
  });

  /** ADR-177 gate: the documented down path runs, through psql in a rolled-back transaction. */
  it("can drop the condition column by the documented down path", () => {
    const columnCount =
      "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Grant' AND column_name = 'condition';";
    const statements = [
      "BEGIN;",
      columnCount,
      documentedDownPath({ migration: GRANT_CONDITION_MIGRATION }),
      columnCount,
      "ROLLBACK;",
    ];
    const output = execFileSync(
      "psql",
      [DB_URL ?? "", "-v", "ON_ERROR_STOP=1", "-qtA", ...statements.flatMap((sql) => ["-c", sql])],
      { encoding: "utf8" },
    );
    // Present before, gone after: a filter that matched nothing would read 0 both times.
    expect(output.trim().split("\n")).toEqual(["1", "0"]);
  });

  it("keeps the condition after the rolled-back down path", async () => {
    await expect(
      prisma.grant.findUnique({ where: { id: sharedGrantId }, select: { condition: true } }),
    ).resolves.toEqual({ condition: CONDITION });
  });

  it("lists the reader's live shared reads by member, whatever their condition says", async () => {
    const malformedGrantId = `grant_${ns}_malformed`;
    await sharedRow({
      id: malformedGrantId,
      scopeId: foreignId,
      condition: { type: "not-a-store" },
    });

    try {
      const live = await writer().findLiveSharedProjectGrants({
        organizationId,
        readerProjectId: readerId,
      });
      expect(new Set(live.map((row) => row.grantId))).toEqual(
        new Set([sharedGrantId, projectedGrantId, malformedGrantId]),
      );
      expect(live.find((row) => row.grantId === malformedGrantId)?.memberProjectId).toBe(foreignId);
    } finally {
      await prisma.grant.deleteMany({ where: { id: malformedGrantId, organizationId } });
    }
  });

  /** @scenario "Revoking a shared grant keeps its row" */
  it("marks the row with the reason, keeps its condition, and moves the epoch forward", async () => {
    const before = (await epoch().findEpoch({ organizationId })) ?? 0;

    const revoked = await writer().revokeSharedProjectGrants({
      organizationId,
      readerProjectId: readerId,
      memberProjectIds: [memberId],
      actor: ACTOR,
      reason: "rule-narrowed",
    });

    expect(new Set(revoked)).toEqual(new Set([sharedGrantId, projectedGrantId]));
    expect(appended.map((call) => call.verb)).toEqual(["revokeGrant", "revokeGrant"]);
    const row = await prisma.grant.findUnique({
      where: { id: sharedGrantId },
      select: { revokedAt: true, revokedReason: true, condition: true },
    });
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe("rule-narrowed");
    expect(row?.condition).toEqual(CONDITION);
    expect(await epoch().findEpoch({ organizationId })).toBeGreaterThan(before);
  });
});
