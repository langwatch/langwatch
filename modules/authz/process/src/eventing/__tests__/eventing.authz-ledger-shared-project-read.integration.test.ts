/**
 * @vitest-environment node
 * ADR-175 block A: a shared project read lives and dies as a ledger fact, against the real
 * Grant table and real project lineage: the row is marked rather than deleted.
 * @see specs/governance/aggregate-project.feature
 */
import { randomUUID } from "node:crypto";

import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StubAuthzEpoch } from "../../repositories/__tests__/support/authz-epoch.stub.ts";
import { EventingAuthzReadRepository } from "../../repositories/eventing/eventing.authz-read.repository.ts";
import { grantFactToRow } from "../../repositories/prisma/prisma.authz-grant.mapper.ts";
import { PrismaAuthzLedgerReadRepository } from "../../repositories/prisma/prisma.authz-ledger-read.repository.ts";
import { PrismaAuthzMembershipStampRepository } from "../../repositories/prisma/prisma.authz-membership-stamp.repository.ts";
import { PrismaAuthzProjectionRepository } from "../../repositories/prisma/prisma.authz-projection.repository.ts";
import { PrismaAuthzRevocationRepository } from "../../repositories/prisma/prisma.authz-revocation.repository.ts";
import { PrismaAuthzSharedReadRepository } from "../../repositories/prisma/prisma.authz-shared-read.repository.ts";
import { AuthzGrantIdentityService } from "../../services/authz-grant-identity.service.ts";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../services/authz-grants-command-dispatcher.service.ts";
import { EventingAuthzLedgerAdapter } from "../authz-grant.store.ts";

const DB_URL = process.env.DATABASE_URL ?? process.env.LANGWATCH_TEST_DATABASE_URL;

const COMMAND_VERBS = [
  "attachGrant",
  "changeGrantRole",
  "revokeGrant",
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
] as const;

const CONDITION = { type: "trace", from: "2026-10-01T00:00:00.000Z" } as const;
const ACTOR = { type: "system" as const, id: SYSTEM_ACTORS.aggregateReconciler };

class RecordingDispatcher extends AuthzGrantsCommandDispatcher {
  constructor(private readonly appended: { verb: string; data: unknown }[]) {
    super();
  }

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    return {
      commands: Object.fromEntries(
        COMMAND_VERBS.map((verb) => [
          verb,
          { send: async (data: unknown) => void this.appended.push({ verb, data }) },
        ]),
      ) as AuthzGrantsCommandSenders,
    };
  }
}

describe.skipIf(!DB_URL)("given a shared project read in the ledger", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const ns = `authz-shared-read-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const deriveGrantId = AuthzGrantIdentityService.create();
  const appended: { verb: string; data: unknown }[] = [];
  const epoch = new StubAuthzEpoch();

  let organizationId: string;
  let foreignOrganizationId: string;
  let teamId: string;
  let readerId: string;
  let memberId: string;
  let foreignId: string;
  let sharedGrantId: string;
  let projectedGrantId: string;

  function writer({
    database = prisma,
    now,
  }: { database?: PrismaClient; now?: () => number } = {}): EventingAuthzLedgerAdapter {
    return EventingAuthzLedgerAdapter.create({
      reads: PrismaAuthzLedgerReadRepository.create({ prisma: database }),
      dispatcher: new RecordingDispatcher(appended),
      epoch,
      revocation: PrismaAuthzRevocationRepository.create({ database }),
      membershipStamps: PrismaAuthzMembershipStampRepository.create({ database }),
      sharedReads: PrismaAuthzSharedReadRepository.create({ database }),
      lineage: EventingAuthzReadRepository.create(database),
      ...(now ? { now } : {}),
    });
  }

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

  /** The row a landed fold leaves behind for one shared read. */
  async function storedSharedRead({
    grantId,
    memberProjectId,
    occurredAt = new Date(),
    revokedAt = null,
    condition = CONDITION,
  }: {
    grantId: string;
    memberProjectId: string;
    occurredAt?: Date;
    revokedAt?: Date | null;
    condition?: unknown;
  }): Promise<void> {
    await prisma.grant.create({
      data: {
        id: grantId,
        organizationId,
        principalType: "PROJECT",
        principalId: readerId,
        roleKey: "project-reader",
        source: "aggregate-reconciler",
        scopeType: "PROJECT",
        scopeId: memberProjectId,
        condition: condition as never,
        occurredAt,
        revokedAt,
        revokedReason: revokedAt ? "aggregate_rule_no_longer_matches" : null,
      },
    });
  }

  beforeAll(async () => {
    organizationId = (
      await prisma.organization.create({
        data: { name: "Shared Read Org", slug: `--test-org-${ns}` },
      })
    ).id;
    teamId = (
      await prisma.team.create({
        data: { name: "Team", slug: `--test-team-${ns}`, organizationId },
      })
    ).id;
    readerId = await project({ team: teamId, suffix: "aggregate" });
    memberId = await project({ team: teamId, suffix: "member" });

    foreignOrganizationId = (
      await prisma.organization.create({
        data: { name: "Foreign Org", slug: `--test-org-${ns}-foreign` },
      })
    ).id;
    const foreignTeamId = (
      await prisma.team.create({
        data: {
          name: "Foreign Team",
          slug: `--test-team-${ns}-foreign`,
          organizationId: foreignOrganizationId,
        },
      })
    ).id;
    foreignId = await project({ team: foreignTeamId, suffix: "foreign" });

    sharedGrantId = `grant_${ns}_shared`;
    await storedSharedRead({ grantId: sharedGrantId, memberProjectId: memberId });
  });

  afterAll(async () => {
    if (organizationId) {
      await cleanupTestRows(prisma, [
        ["grant", { organizationId }],
        ["project", { slug: { startsWith: `--test-project-${ns}` } }],
        ["team", { organizationId }],
        ["team", { organizationId: foreignOrganizationId }],
        ["organization", { id: { in: [organizationId, foreignOrganizationId] } }],
      ]);
    }
    await prisma.$disconnect();
  });

  // The refusal across two organisations.
  /** @scenario "Only the project-reader shape lifts the foreign-project refusal" */
  it("refuses a shared read on a project in another organisation against real lineage", async () => {
    const sent = appended.length;
    await expect(
      writer().attachSharedProjectGrant({
        organizationId,
        readerProjectId: readerId,
        memberProjectId: foreignId,
        condition: CONDITION,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: "grant_validation_failed" });
    expect(appended).toHaveLength(sent);
  });

  it("returns the live shared read as it stands instead of emitting it again", async () => {
    const sent = appended.length;
    const outcome = await writer().attachSharedProjectGrant({
      organizationId,
      readerProjectId: readerId,
      memberProjectId: memberId,
      condition: CONDITION,
      actor: ACTOR,
    });
    expect(outcome).toEqual({ grantId: sharedGrantId, wasAttached: false });
    expect(appended).toHaveLength(sent);
  });

  it("gives a pair revoked earlier in the same second a fresh id rather than the revoked row's", async () => {
    const frozenMs = Date.UTC(2026, 9, 7, 10, 0, 0, 400);
    const sameSecondMember = await project({ team: teamId, suffix: "same-second" });
    const revokedSameSecond = deriveGrantId.deriveGrantId({
      organizationId,
      principal: { type: "project", id: readerId },
      scope: { type: "PROJECT", id: sameSecondMember },
      occurredAtMs: frozenMs,
    });
    await storedSharedRead({
      grantId: revokedSameSecond,
      memberProjectId: sameSecondMember,
      occurredAt: new Date(frozenMs),
      revokedAt: new Date(frozenMs),
    });
    const sent = appended.length;

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
    const command = appended[sent]?.data as { grant: { grantId: string; occurredAtMs: number } };
    expect(command.grant.grantId).toBe(outcome.grantId);
    expect(command.grant.occurredAtMs).toBe((Math.floor(frozenMs / 1000) + 1) * 1000);
    appended.splice(sent);
    await prisma.grant.deleteMany({ where: { id: revokedSameSecond, organizationId } });
  });

  it("returns a live row that landed this second after its first read, rather than a second live row", async () => {
    const frozenMs = Date.UTC(2026, 9, 7, 11, 0, 0, 400);
    const racedMember = await project({ team: teamId, suffix: "raced" });
    // What a concurrent attach of the same pair leaves: the live row on this second's id.
    const landedConcurrently = deriveGrantId.deriveGrantId({
      organizationId,
      principal: { type: "project", id: readerId },
      scope: { type: "PROJECT", id: racedMember },
      occurredAtMs: frozenMs,
    });
    await storedSharedRead({
      grantId: landedConcurrently,
      memberProjectId: racedMember,
      occurredAt: new Date(frozenMs),
    });
    // The writer's first look for a live row of the pair ran before that row landed.
    let firstLookup = true;
    const racedPrisma = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== "grant") return Reflect.get(target, property, receiver);
        return new Proxy(target.grant, {
          get(grants, method, grantsReceiver) {
            if (method === "findMany" && firstLookup) {
              firstLookup = false;
              return async () => [];
            }
            return Reflect.get(grants, method, grantsReceiver);
          },
        });
      },
    });
    const sent = appended.length;

    const outcome = await writer({
      database: racedPrisma,
      now: () => frozenMs,
    }).attachSharedProjectGrant({
      organizationId,
      readerProjectId: readerId,
      memberProjectId: racedMember,
      condition: CONDITION,
      actor: ACTOR,
      awaitProjection: false,
    });

    expect(firstLookup).toBe(false);
    expect(outcome).toEqual({ grantId: landedConcurrently, wasAttached: false });
    expect(appended).toHaveLength(sent);
    await prisma.grant.deleteMany({ where: { id: landedConcurrently, organizationId } });
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

    expect(
      await prisma.grant.findUnique({
        where: { id: projectedGrantId },
        select: { condition: true, roleKey: true, principalType: true },
      }),
    ).toEqual({ condition: CONDITION, roleKey: "project-reader", principalType: "PROJECT" });
    // A shared read is neither a membership nor a share link: the legacy heads stay silent.
    expect(await prisma.roleBinding.findUnique({ where: { id: projectedGrantId } })).toBeNull();
    expect(await prisma.shareLink.findUnique({ where: { id: projectedGrantId } })).toBeNull();
  });

  it("lists the reader's live shared reads by member, whatever their condition says", async () => {
    const malformedGrantId = `grant_${ns}_malformed`;
    await storedSharedRead({
      grantId: malformedGrantId,
      memberProjectId: foreignId,
      condition: { type: "not-a-store" },
    });

    const live = await writer().findLiveSharedProjectGrants({
      organizationId,
      readerProjectId: readerId,
    });

    expect(new Set(live.map((row) => row.grantId))).toEqual(
      new Set([sharedGrantId, projectedGrantId, malformedGrantId]),
    );
    expect(live.find((row) => row.grantId === malformedGrantId)?.memberProjectId).toBe(foreignId);
    await prisma.grant.deleteMany({ where: { id: malformedGrantId, organizationId } });
  });

  /** @scenario "Revoking a shared grant keeps its row" */
  it("marks the row with the reason, keeps its condition, and moves the epoch forward", async () => {
    const sent = appended.length;
    epoch.bump.mockClear();

    const revoked = await writer().revokeSharedProjectGrants({
      organizationId,
      readerProjectId: readerId,
      memberProjectIds: [memberId],
      actor: ACTOR,
      reason: "rule-narrowed",
    });

    expect(new Set(revoked)).toEqual(new Set([sharedGrantId, projectedGrantId]));
    expect(appended.slice(sent).map((call) => call.verb)).toEqual(["revokeGrant", "revokeGrant"]);
    const row = await prisma.grant.findUnique({
      where: { id: sharedGrantId },
      select: { revokedAt: true, revokedReason: true, condition: true },
    });
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe("rule-narrowed");
    expect(row?.condition).toEqual(CONDITION);
    expect(epoch.bump).toHaveBeenCalledWith({ organizationId });
  });
});
