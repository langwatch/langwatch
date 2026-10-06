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
import { SYSTEM_ACTORS } from "@langwatch/actor";
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

  /** @scenario "Only the project-reader shape lifts the foreign-project refusal" (across two organisations) */
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

    expect(revoked).toEqual([sharedGrantId]);
    expect(appended.map((call) => call.verb)).toEqual(["revokeGrant"]);

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
