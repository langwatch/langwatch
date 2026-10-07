/**
 * @vitest-environment node
 *
 * ADR-144 block A: a shared project read lives and dies as a ledger fact.
 * Real Postgres and real Redis on purpose - the promise is that the row is
 * marked rather than deleted and that the organisation's epoch moves, not
 * that the writer called a method.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { execFileSync } from "node:child_process";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { grantFactToRow } from "@langwatch/authz-server";
import { deriveGrantId } from "@langwatch/authz-server/migration";
import { RedisConnectionService } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GrantPrincipalType,
  GrantScopeType,
  type Organization,
  type Project,
} from "~/generated/prisma/client";
import { type App, globalForApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getAuthzEpoch } from "../epoch";
import { type AuthzGrantsCommandSenders, GrantsLedgerWriter } from "../ledger";
import { PrismaAuthzGrantsWriteRepository } from "../repositories/authz-grants-write.prisma.repository";

const ns = `authz-shared-read-${nanoid(8)}`;

const COMMAND_VERBS = [
  "attachGrant",
  "changeGrantRole",
  "revokeGrant",
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
] as const;

const CONDITION = { type: "trace", from: "2026-10-01T00:00:00.000Z" } as const;

describe("given a shared project read in the ledger", () => {
  const appended: Array<{ verb: string; data: unknown }> = [];

  let organization: Organization;
  let foreignOrganization: Organization;
  let reader: Project;
  let member: Project;
  let foreign: Project;
  let sharedGrantId: string;
  let projectedGrantId: string;
  let previousApp: App | null = null;
  let redis: ReturnType<RedisConnectionService["connect"]>;

  const writer = () =>
    new GrantsLedgerWriter(prisma, {
      commands: async () => ({
        commands: Object.fromEntries(
          COMMAND_VERBS.map((verb) => [
            verb,
            {
              send: async (data: unknown) => {
                appended.push({ verb, data });
              },
            },
          ]),
        ) as unknown as AuthzGrantsCommandSenders,
      }),
    });

  async function project({
    teamId,
    suffix,
  }: {
    teamId: string;
    suffix: string;
  }): Promise<Project> {
    return prisma.project.create({
      data: {
        name: `Project ${suffix}`,
        slug: `--test-project-${ns}-${suffix}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
  }

  beforeAll(async () => {
    redis = new RedisConnectionService().connect({
      url: process.env.REDIS_URL,
      clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: process.env.REDIS_DB_INDEX,
    });
    if (!redis) {
      throw new Error(
        "This suite needs Redis. Set REDIS_URL (or REDIS_CLUSTER_ENDPOINTS) in platform/app/.env.",
      );
    }
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = { redis } as unknown as App;

    organization = await prisma.organization.create({
      data: { name: "Shared Read Org", slug: `--test-org-${ns}` },
    });
    const team = await prisma.team.create({
      data: {
        name: "Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    reader = await project({ teamId: team.id, suffix: "aggregate" });
    member = await project({ teamId: team.id, suffix: "member" });

    foreignOrganization = await prisma.organization.create({
      data: { name: "Foreign Org", slug: `--test-org-${ns}-foreign` },
    });
    const foreignTeam = await prisma.team.create({
      data: {
        name: "Foreign Team",
        slug: `--test-team-${ns}-foreign`,
        organizationId: foreignOrganization.id,
      },
    });
    foreign = await project({ teamId: foreignTeam.id, suffix: "foreign" });

    // The row a landed fold leaves behind for one shared read.
    sharedGrantId = `grant_${ns}_shared`;
    await prisma.grant.create({
      data: {
        id: sharedGrantId,
        organizationId: organization.id,
        principalType: GrantPrincipalType.PROJECT,
        principalId: reader.id,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: GrantScopeType.PROJECT,
        scopeId: member.id,
        condition: CONDITION,
        occurredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    globalForApp.__langwatch_app = previousApp;
    redis?.disconnect();
    if (!organization?.id) return;
    await cleanupTestRows(prisma, [
      ["grant", { organizationId: organization.id }],
      ["project", { id: { in: [reader.id, member.id, foreign.id] } }],
      ["team", { organizationId: organization.id }],
      ["team", { organizationId: foreignOrganization.id }],
      ["organization", { id: organization.id }],
      ["organization", { id: foreignOrganization.id }],
    ]);
  });

  // The refusal across two organisations.
  /** @scenario "Only the project-reader shape lifts the foreign-project refusal" */
  it("refuses a shared read on a project in another organisation against real lineage", async () => {
    await expect(
      writer().attachSharedProjectGrant({
        organizationId: organization.id,
        readerProjectId: reader.id,
        memberProjectId: foreign.id,
        condition: CONDITION,
        actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
      }),
    ).rejects.toMatchObject({ code: "grant_validation_failed" });
    expect(appended).toHaveLength(0);
  });

  it("returns the live shared read as it stands instead of emitting it again", async () => {
    const outcome = await writer().attachSharedProjectGrant({
      organizationId: organization.id,
      readerProjectId: reader.id,
      memberProjectId: member.id,
      condition: CONDITION,
      actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
    });
    expect(outcome).toEqual({ grantId: sharedGrantId, attached: false });
    expect(appended).toHaveLength(0);
  });

  it("gives a pair revoked earlier in the same second a fresh id rather than the revoked row's", async () => {
    const frozenMs = Date.UTC(2026, 9, 7, 10, 0, 0, 400);
    // A member of this organisation, so the lineage check passes.
    const sameSecondMember = await project({
      teamId: reader.teamId,
      suffix: "same-second",
    });
    const revokedSameSecond = deriveGrantId({
      organizationId: organization.id,
      principal: { type: "project", id: reader.id },
      scope: { type: "PROJECT", id: sameSecondMember.id },
      occurredAtMs: frozenMs,
    });
    await prisma.grant.create({
      data: {
        id: revokedSameSecond,
        organizationId: organization.id,
        principalType: GrantPrincipalType.PROJECT,
        principalId: reader.id,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: GrantScopeType.PROJECT,
        scopeId: sameSecondMember.id,
        condition: CONDITION,
        occurredAt: new Date(frozenMs),
        revokedAt: new Date(frozenMs),
        revokedReason: "aggregate_rule_no_longer_matches",
      },
    });
    const sent = appended.length;

    try {
      const outcome = await new GrantsLedgerWriter(prisma, {
        now: () => frozenMs,
        commands: async () => ({
          commands: Object.fromEntries(
            COMMAND_VERBS.map((verb) => [
              verb,
              {
                send: async (data: unknown) => {
                  appended.push({ verb, data });
                },
              },
            ]),
          ) as unknown as AuthzGrantsCommandSenders,
        }),
      }).attachSharedProjectGrant({
        organizationId: organization.id,
        readerProjectId: reader.id,
        memberProjectId: sameSecondMember.id,
        condition: CONDITION,
        actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
        awaitProjection: false,
      });

      expect(outcome.attached).toBe(true);
      expect(outcome.grantId).not.toBe(revokedSameSecond);
      const command = appended[sent]?.data as {
        grant: { grantId: string; occurredAtMs: number };
      };
      expect(command.grant.grantId).toBe(outcome.grantId);
      expect(command.grant.occurredAtMs).toBe(
        (Math.floor(frozenMs / 1000) + 1) * 1000,
      );
    } finally {
      appended.splice(sent);
      await prisma.grant.deleteMany({
        where: { id: revokedSameSecond, organizationId: organization.id },
      });
      await prisma.project.deleteMany({ where: { id: sameSecondMember.id } });
    }
  });

  it("returns a live row that landed this second after its first read, rather than a second live row", async () => {
    const frozenMs = Date.UTC(2026, 9, 7, 11, 0, 0, 400);
    const racedMember = await project({
      teamId: reader.teamId,
      suffix: "raced",
    });
    // What a concurrent attach of the same pair leaves: the live row on the
    // id this second derives.
    const landedConcurrently = deriveGrantId({
      organizationId: organization.id,
      principal: { type: "project", id: reader.id },
      scope: { type: "PROJECT", id: racedMember.id },
      occurredAtMs: frozenMs,
    });
    await prisma.grant.create({
      data: {
        id: landedConcurrently,
        organizationId: organization.id,
        principalType: GrantPrincipalType.PROJECT,
        principalId: reader.id,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: GrantScopeType.PROJECT,
        scopeId: racedMember.id,
        condition: CONDITION,
        occurredAt: new Date(frozenMs),
      },
    });
    // The writer's first look for a live row of the pair ran before that row
    // landed, so it answers nothing; every later read sees the table.
    let firstLookup = true;
    const racedPrisma = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== "grant") return Reflect.get(target, property, receiver);
        return new Proxy(target.grant, {
          get(grants, method, grantsReceiver) {
            if (method === "findFirst" && firstLookup) {
              firstLookup = false;
              return async () => null;
            }
            return Reflect.get(grants, method, grantsReceiver);
          },
        });
      },
    });
    const sent = appended.length;

    try {
      const outcome = await new GrantsLedgerWriter(racedPrisma, {
        now: () => frozenMs,
        commands: async () => ({
          commands: Object.fromEntries(
            COMMAND_VERBS.map((verb) => [
              verb,
              {
                send: async (data: unknown) => {
                  appended.push({ verb, data });
                },
              },
            ]),
          ) as unknown as AuthzGrantsCommandSenders,
        }),
      }).attachSharedProjectGrant({
        organizationId: organization.id,
        readerProjectId: reader.id,
        memberProjectId: racedMember.id,
        condition: CONDITION,
        actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
        awaitProjection: false,
      });

      expect(firstLookup).toBe(false);
      expect(outcome).toEqual({
        grantId: landedConcurrently,
        attached: false,
      });
      expect(appended).toHaveLength(sent);
    } finally {
      appended.splice(sent);
      await prisma.grant.deleteMany({
        where: { id: landedConcurrently, organizationId: organization.id },
      });
      await prisma.project.deleteMany({ where: { id: racedMember.id } });
    }
  });

  it("lands a shared read through the projection's raw upsert with its condition and no legacy head", async () => {
    projectedGrantId = `grant_${ns}_projected`;
    await new PrismaAuthzGrantsWriteRepository(prisma).append({
      kind: "grant.upsert",
      row: grantFactToRow({
        organizationId: organization.id,
        grant: {
          grantId: projectedGrantId,
          principal: { type: "project", id: reader.id },
          roleKey: "project-reader",
          scope: { type: "PROJECT", id: member.id },
          condition: CONDITION,
          source: "aggregate-reconciler",
          occurredAtMs: Date.now(),
        },
      }),
    });

    const row = await prisma.grant.findUnique({
      where: { id: projectedGrantId },
      select: { condition: true, roleKey: true, principalType: true },
    });
    expect(row).toEqual({
      condition: CONDITION,
      roleKey: "project-reader",
      principalType: GrantPrincipalType.PROJECT,
    });
    // A shared read is neither a membership nor a share link, so the
    // legacy heads stay silent about it.
    expect(
      await prisma.roleBinding.findUnique({ where: { id: projectedGrantId } }),
    ).toBeNull();
    expect(
      await prisma.shareLink.findUnique({ where: { id: projectedGrantId } }),
    ).toBeNull();
  });

  /** ADR-144 gate: the migration's documented down path is a statement
   *  that runs. Executed through psql inside one transaction that is rolled
   *  back (the app's Prisma client refuses raw statements without tenancy),
   *  so the column is there again before the next test. */
  it("can drop the condition column by the documented down path", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set for this suite");
    const output = execFileSync(
      "psql",
      [
        databaseUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-tA",
        "-c",
        [
          "BEGIN;",
          'ALTER TABLE "Grant" DROP COLUMN "condition";',
          "SELECT count(*) FROM information_schema.columns WHERE table_name = 'Grant' AND column_name = 'condition';",
          "ROLLBACK;",
        ].join(" "),
      ],
      { encoding: "utf8" },
    );
    expect(output.trim().split("\n")).toContain("0");
    const after = await prisma.grant.findUnique({
      where: { id: sharedGrantId },
      select: { condition: true },
    });
    expect(after?.condition).toEqual(CONDITION);
  });

  it("lists the reader's live shared reads by member, whatever their condition says", async () => {
    const malformedGrantId = `grant_${ns}_malformed`;
    await prisma.grant.create({
      data: {
        id: malformedGrantId,
        organizationId: organization.id,
        principalType: GrantPrincipalType.PROJECT,
        principalId: reader.id,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: GrantScopeType.PROJECT,
        scopeId: foreign.id,
        condition: { type: "not-a-store" },
        occurredAt: new Date(),
      },
    });

    try {
      const live = await writer().findLiveSharedProjectGrants({
        organizationId: organization.id,
        readerProjectId: reader.id,
      });
      expect(new Set(live.map((row) => row.grantId))).toEqual(
        new Set([sharedGrantId, projectedGrantId, malformedGrantId]),
      );
      expect(
        live.find((row) => row.grantId === malformedGrantId)?.memberProjectId,
      ).toBe(foreign.id);
    } finally {
      await prisma.grant.deleteMany({
        where: { id: malformedGrantId, organizationId: organization.id },
      });
    }
  });

  /** @scenario "Revoking a shared grant keeps its row" */
  it("marks the row with the reason, keeps its condition, and moves the epoch forward", async () => {
    const before =
      (await getAuthzEpoch({ organizationId: organization.id })) ?? 0;

    const revoked = await writer().revokeSharedProjectGrants({
      organizationId: organization.id,
      readerProjectId: reader.id,
      memberProjectIds: [member.id],
      actor: { type: "system", id: SYSTEM_ACTORS.aggregateReconciler },
      reason: "rule-narrowed",
    });

    expect(new Set(revoked)).toEqual(
      new Set([sharedGrantId, projectedGrantId]),
    );
    expect(appended.map((call) => call.verb)).toEqual([
      "revokeGrant",
      "revokeGrant",
    ]);

    const row = await prisma.grant.findUnique({
      where: { id: sharedGrantId },
      select: { revokedAt: true, revokedReason: true, condition: true },
    });
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe("rule-narrowed");
    expect(row?.condition).toEqual(CONDITION);

    const after = await getAuthzEpoch({ organizationId: organization.id });
    expect(after).not.toBeNull();
    expect(after!).toBeGreaterThan(before);
  });
});
