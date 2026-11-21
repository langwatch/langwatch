/**
 * @vitest-environment node
 * Real Postgres: the two queries the personal-key mark step pages and writes with.
 * @see modules/gateway/specs/gateway-budget-service.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGatewayTestPrismaConnection } from "../../../app/__tests__/gateway-prisma.fixture.ts";
import { PrismaGatewayVirtualKeyRepository } from "../prisma.virtual-key.repository.ts";

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl ? createGatewayTestPrismaConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

/** Letters and digits only, so every collation sorts this run's keys right after the prefix. */
const PREFIX = `vkpm${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
const ORG_ID = `org${PREFIX}`;
const USER_ID = `usr${PREFIX}`;
const KEYS = { first: `${PREFIX}a`, second: `${PREFIX}b`, shared: `${PREFIX}c` };

async function seedKey({ id, principalUserId }: { id: string; principalUserId: string | null }) {
  await prisma.virtualKey.create({
    data: {
      id,
      organizationId: ORG_ID,
      name: id,
      hashedSecret: `hash-${id}`,
      displayPrefix: "vk-lw-test",
      config: {},
      createdById: USER_ID,
      principalUserId,
      // A row as the release before the mark wrote it.
      mintedAsPersonal: false,
    },
  });
}

async function markedIds(): Promise<string[]> {
  const rows = await prisma.virtualKey.findMany({
    where: { id: { in: Object.values(KEYS) }, mintedAsPersonal: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}

describe.skipIf(!databaseUrl)("the personal-key mark queries against real Postgres", () => {
  const repository = () => PrismaGatewayVirtualKeyRepository.create(prisma);

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@example.com` } });
    await seedKey({ id: KEYS.first, principalUserId: USER_ID });
    await seedKey({ id: KEYS.second, principalUserId: USER_ID });
    await seedKey({ id: KEYS.shared, principalUserId: null });
  });

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await connection?.closeOnce();
  });

  describe("given two unmarked keys with a principal and one without", () => {
    /** @scenario "Keys minted for a person before the mark existed are marked by a background step" */
    it("lists the keys with a principal after the cursor, marks them, then lists them no more", async () => {
      expect(await repository().findUnmarkedPersonalIds({ afterId: PREFIX, limit: 2 })).toEqual([
        KEYS.first,
        KEYS.second,
      ]);

      const marked = await repository().markMintedAsPersonal({
        ids: [KEYS.first, KEYS.second, KEYS.shared],
      });

      expect(marked).toBe(2);
      expect(await markedIds()).toEqual([KEYS.first, KEYS.second]);
      const listed = await repository().findUnmarkedPersonalIds({ afterId: PREFIX, limit: 10 });
      expect(listed).not.toContain(KEYS.first);
      expect(listed).not.toContain(KEYS.second);
      expect(listed).not.toContain(KEYS.shared);
    });

    /** @scenario "Keys minted for a person before the mark existed are marked by a background step" */
    it("marks nothing on a second write over the same keys", async () => {
      await repository().markMintedAsPersonal({ ids: [KEYS.first, KEYS.second] });

      expect(await repository().markMintedAsPersonal({ ids: [KEYS.first, KEYS.second] })).toBe(0);
      expect(await markedIds()).toEqual([KEYS.first, KEYS.second]);
    });
  });
});
