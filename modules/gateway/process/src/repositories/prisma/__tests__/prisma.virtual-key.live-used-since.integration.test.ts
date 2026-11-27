/**
 * @vitest-environment node
 * Real Postgres: the unbudgeted-spend sweep's one read across organizations passes the tenancy
 * guard and lists only live keys of the purpose asked for, used inside the window.
 * @see modules/gateway/specs/gateway-governance-events.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, toDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGatewayTestPrismaConnection } from "../../../app/__tests__/gateway-prisma.fixture.ts";
import { PrismaGatewayVirtualKeyRepository } from "../prisma.virtual-key.repository.ts";

const databaseUrl = process.env.DATABASE_URL;
// Seeding and cleanup only: the read under test goes through the production guard below.
const connection = databaseUrl ? createGatewayTestPrismaConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;
const skippedTables: string[] = [];
const guarded = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create({
        onSkippedTenantCheck: ({ table }) => skippedTables.push(table),
      }),
      logger: createLogger("langwatch:gateway:test:live-used-since"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

const ns = nanoid(8);
const ORG_IDS = [`org-used-a-${ns}`, `org-used-b-${ns}`];
const SINCE = Temporal.Instant.from("2026-11-19T00:00:00Z");

type Seed = {
  id: string;
  organizationId: string;
  purpose?: "USER" | "LANGY" | "CONNECT";
  status?: "ACTIVE" | "DISABLED" | "REVOKED";
  revokedAt?: Date;
  lastUsedAt: Date | null;
  traceProjectId?: string;
};

const [ORG_A, ORG_B] = ORG_IDS as [string, string];
const seeds: Seed[] = [
  { id: `vk-used-${ns}`, organizationId: ORG_A, lastUsedAt: toDate(SINCE), traceProjectId: "p" },
  { id: `vk-other-org-${ns}`, organizationId: ORG_B, lastUsedAt: toDate(SINCE) },
  {
    id: `vk-old-${ns}`,
    organizationId: ORG_A,
    lastUsedAt: toDate(SINCE.subtract({ milliseconds: 1 })),
  },
  { id: `vk-never-${ns}`, organizationId: ORG_A, lastUsedAt: null },
  { id: `vk-langy-${ns}`, organizationId: ORG_A, purpose: "LANGY", lastUsedAt: toDate(SINCE) },
  { id: `vk-disabled-${ns}`, organizationId: ORG_A, status: "DISABLED", lastUsedAt: toDate(SINCE) },
  {
    id: `vk-revoked-${ns}`,
    organizationId: ORG_A,
    status: "REVOKED",
    revokedAt: toDate(SINCE),
    lastUsedAt: toDate(SINCE),
  },
];

describe.skipIf(!databaseUrl)("the fleet read of recently used virtual keys", () => {
  beforeAll(async () => {
    for (const id of ORG_IDS) {
      await prisma.organization.create({ data: { id, name: id, slug: id } });
    }
    for (const seed of seeds) {
      await prisma.virtualKey.create({
        data: {
          id: seed.id,
          organizationId: seed.organizationId,
          name: `${seed.id} name`,
          hashedSecret: `hash-${seed.id}`,
          displayPrefix: "vk-lw-test",
          createdById: `usr-${ns}`,
          purpose: seed.purpose ?? "USER",
          status: seed.status ?? "ACTIVE",
          revokedAt: seed.revokedAt ?? null,
          lastUsedAt: seed.lastUsedAt,
          traceProjectId: seed.traceProjectId ?? null,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({ where: { organizationId: { in: ORG_IDS } } });
    await prisma.organization.deleteMany({ where: { id: { in: ORG_IDS } } });
    await connection?.closeOnce();
    await guarded?.closeOnce();
  });

  /** @scenario "The unbudgeted-spend sweep reads live person keys across organizations in Postgres" */
  it("passes the tenancy guard as one counted skip", async () => {
    const repository = PrismaGatewayVirtualKeyRepository.create(guarded?.client as PrismaClient);

    await repository.findLiveUsedSince({ purpose: "USER", since: SINCE });

    expect(skippedTables).toEqual(["VirtualKey"]);
  });

  /** @scenario "The unbudgeted-spend sweep reads live person keys across organizations in Postgres" */
  it("lists each organization's active, unrevoked USER keys used since the instant, by id", async () => {
    const repository = PrismaGatewayVirtualKeyRepository.create(guarded?.client as PrismaClient);

    const used = await repository.findLiveUsedSince({ purpose: "USER", since: SINCE });

    expect(used.filter(({ organizationId }) => ORG_IDS.includes(organizationId))).toEqual(
      [
        {
          id: `vk-other-org-${ns}`,
          organizationId: ORG_B,
          name: `vk-other-org-${ns} name`,
          principalUserId: null,
          traceProjectId: null,
        },
        {
          id: `vk-used-${ns}`,
          organizationId: ORG_A,
          name: `vk-used-${ns} name`,
          principalUserId: null,
          traceProjectId: "p",
        },
      ].toSorted((left, right) => (left.id < right.id ? -1 : 1)),
    );
  });
});
