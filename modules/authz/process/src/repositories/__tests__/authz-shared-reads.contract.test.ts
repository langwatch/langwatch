/**
 * @vitest-environment node
 * ADR-175: the live shared reads one project holds on others answer the same way on each
 * backend. The memory row always runs; Postgres joins in the integration lane.
 * @see specs/governance/aggregate-project.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { type Instant, Temporal } from "@langwatch/time";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "../memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzRevocationRepository } from "../memory/memory.authz-revocation.repository.ts";
import { MemoryAuthzSharedReadRepository } from "../memory/memory.authz-shared-read.repository.ts";
import type { GrantRowShape } from "../prisma/prisma.authz-grant.mapper.ts";
import { PostgresAuthzRepositories } from "../prisma/prisma.authz.repositories.ts";

type SharedReadFixture = Readonly<{
  repositories: Pick<AuthzRepositories, "grantProjection" | "revocation" | "sharedReads">;
  organizationId: string;
  /** Overwrites a stored condition with a value no writer would produce. */
  corruptCondition: (input: { grantId: string; condition: unknown }) => Promise<void>;
  close: () => Promise<void>;
}>;

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const at = (ms: number): Instant => Temporal.Instant.fromEpochMilliseconds(ms);
const T0 = 1_760_000_000_000;
const CONTEXT = { aggregateId: "grant", tenantId: createTenantId("org_contract") };
const CONDITION = { type: "trace", from: "2026-10-01T00:00:00.000Z" } as const;

function memoryFixture(): SharedReadFixture {
  const memory = AuthzMemoryStore.create();
  return {
    repositories: {
      grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
      revocation: MemoryAuthzRevocationRepository.create({ memory }),
      sharedReads: MemoryAuthzSharedReadRepository.create({ memory }),
    },
    organizationId: id("org"),
    corruptCondition: async ({ grantId, condition }) => {
      const row = memory.grants.find((candidate) => candidate.id === grantId);
      if (row) Object.assign(row, { condition });
    },
    close: async () => {},
  };
}

/** The integration lane's Postgres; the unit lane never sets it, so the row is skipped there. */
const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
let prisma: PrismaClient | undefined;

async function postgresFixture(): Promise<SharedReadFixture> {
  prisma ??= new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const database = prisma;
  const organizationId = (
    await database.organization.create({
      data: { name: "Shared reads", slug: `--test-org-${id("shared")}` },
    })
  ).id;
  return {
    repositories: PostgresAuthzRepositories.create({ prisma: database }),
    organizationId,
    corruptCondition: async ({ grantId, condition }) => {
      await database.grant.updateMany({
        where: { id: grantId, organizationId },
        data: { condition: condition as never },
      });
    },
    close: async () => {
      await cleanupTestRows(database, [
        ["grant", { organizationId }],
        ["organization", { id: organizationId }],
      ]);
    },
  };
}

const backends = [
  { name: "memory", skip: false, open: async () => memoryFixture() },
  { name: "postgres", skip: !DB_URL, open: postgresFixture },
];

afterAll(async () => {
  await prisma?.$disconnect();
});

function sharedRead({
  organizationId,
  readerProjectId,
  memberProjectId,
  expiresAt = null,
}: {
  organizationId: string;
  readerProjectId: string;
  memberProjectId: string;
  expiresAt?: Instant | null;
}): GrantRowShape {
  return {
    id: id("grant"),
    organizationId,
    principalType: "PROJECT",
    principalId: readerProjectId,
    roleKey: "project-reader",
    legacyRole: null,
    source: "aggregate-reconciler",
    scopeType: "PROJECT",
    scopeId: memberProjectId,
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt,
    maxViews: null,
    condition: CONDITION,
    occurredAt: at(T0),
  };
}

function openPerTest(backend: (typeof backends)[number]): () => Promise<SharedReadFixture> {
  let opened: SharedReadFixture | undefined;
  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });
  return async () => {
    opened = await backend.open();
    return opened;
  };
}

describe.each(backends)("given shared project reads on the $name backend", (backend) => {
  const open = openPerTest(backend);

  /** Seeds, for one reader: two live members, one revoked member, and two neighbours. */
  async function seed(fixture: SharedReadFixture) {
    const { organizationId, repositories } = fixture;
    const reader = id("proj_aggregate");
    const { condition: _ownGrantsCarryNone, ...ownGrant } = sharedRead({
      organizationId,
      readerProjectId: "user_ana",
      memberProjectId: "proj_a",
    });
    const rows = {
      memberB: sharedRead({ organizationId, readerProjectId: reader, memberProjectId: "proj_b" }),
      memberA: sharedRead({
        organizationId,
        readerProjectId: reader,
        memberProjectId: "proj_a",
        expiresAt: at(T0 + 86_400_000),
      }),
      revoked: sharedRead({ organizationId, readerProjectId: reader, memberProjectId: "proj_c" }),
      otherReader: sharedRead({
        organizationId,
        readerProjectId: id("proj_other"),
        memberProjectId: "proj_a",
      }),
      ownGrant: { ...ownGrant, principalType: "USER", roleKey: "viewer" } satisfies GrantRowShape,
    };
    for (const row of Object.values(rows)) {
      await repositories.grantProjection.append({ kind: "grant.upsert", row }, CONTEXT);
    }
    await repositories.revocation.enforceGrantRevocation({
      organizationId,
      grantIds: [rows.revoked.id],
      reason: "revocation",
      revokedAt: at(T0 + 1_000),
    });
    return { reader, rows };
  }

  describe.skipIf(backend.skip)("when the minter reads one reader's shared reads", () => {
    it("answers the live project-reader rows with their parsed window and expiry", async () => {
      const fixture = await open();
      const { reader, rows } = await seed(fixture);

      const reads = await fixture.repositories.sharedReads.findLiveSharedReads({
        organizationId: fixture.organizationId,
        readerProjectId: reader,
      });

      expect(reads.toSorted((a, b) => a.memberProjectId.localeCompare(b.memberProjectId))).toEqual([
        {
          grantId: rows.memberA.id,
          memberProjectId: "proj_a",
          condition: CONDITION,
          expiresAt: at(T0 + 86_400_000),
        },
        {
          grantId: rows.memberB.id,
          memberProjectId: "proj_b",
          condition: CONDITION,
          expiresAt: null,
        },
      ]);
    });

    it("leaves out a row whose stored condition does not parse, but still lists it", async () => {
      const fixture = await open();
      const { reader, rows } = await seed(fixture);
      await fixture.corruptCondition({ grantId: rows.memberB.id, condition: { type: "metric" } });

      const reads = await fixture.repositories.sharedReads.findLiveSharedReads({
        organizationId: fixture.organizationId,
        readerProjectId: reader,
      });
      const listed = await fixture.repositories.sharedReads.findLiveSharedReadGrants({
        organizationId: fixture.organizationId,
        readerProjectId: reader,
      });

      expect(reads.map((read) => read.grantId)).toEqual([rows.memberA.id]);
      expect(listed).toEqual([
        { grantId: rows.memberA.id, memberProjectId: "proj_a" },
        { grantId: rows.memberB.id, memberProjectId: "proj_b" },
      ]);
    });
  });

  describe.skipIf(backend.skip)("when the ledger lists, narrows and probes ids", () => {
    it("narrows the live list to the members named", async () => {
      const fixture = await open();
      const { reader, rows } = await seed(fixture);

      expect(
        await fixture.repositories.sharedReads.findLiveSharedReadGrants({
          organizationId: fixture.organizationId,
          readerProjectId: reader,
          memberProjectIds: ["proj_b", "proj_c"],
        }),
      ).toEqual([{ grantId: rows.memberB.id, memberProjectId: "proj_b" }]);
    });

    it("states whether each id is held and revoked, live or not", async () => {
      const fixture = await open();
      const { rows } = await seed(fixture);

      const states = await fixture.repositories.sharedReads.findGrantStates({
        organizationId: fixture.organizationId,
        grantIds: [rows.memberA.id, rows.revoked.id, id("grant_absent")],
      });

      expect(states.toSorted((a, b) => a.grantId.localeCompare(b.grantId))).toEqual(
        [
          { grantId: rows.memberA.id, isRevoked: false },
          { grantId: rows.revoked.id, isRevoked: true },
        ].toSorted((a, b) => a.grantId.localeCompare(b.grantId)),
      );
    });
  });
});
