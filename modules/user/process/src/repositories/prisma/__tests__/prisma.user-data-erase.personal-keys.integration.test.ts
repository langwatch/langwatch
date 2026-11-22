/**
 * @vitest-environment node
 * Postgres erasure: a key an admin minted for a member stays marked personal once erasing the
 * member nulls its principal, whether or not the gateway's mark step reached it first.
 * @see modules/user/specs/data-erasure.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaGdprUserDataEraseRepository } from "../prisma.user-data-erase.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `erase-vk-${randomUUID()}`;
const KEY_ID = `${RUN}-key`;
const OTHER_KEY_ID = `${RUN}-other-key`;
const ORGANIZATION_ID = `${RUN}-org`;

/** The erase is cross-tenant by design, so it runs unscoped. */
class AllowEraseQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** A key an admin minted for one member, unmarked as the release before the mark wrote it. */
function unmarkedKey({
  id,
  createdById,
  principalUserId,
}: {
  id: string;
  createdById: string;
  principalUserId: string;
}) {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    name: id,
    hashedSecret: `hash-${id}`,
    displayPrefix: "vk-lw-test",
    config: {},
    createdById,
    principalUserId,
    mintedAsPersonal: false,
  };
}

describe.skipIf(!databaseUrl)("given a key an admin minted for a member, before the mark", () => {
  let connection: PrismaConnection;
  let adminId: string;
  let memberId: string;
  let otherMemberId: string;
  let editedAt: string;
  let otherKeyBefore: {
    principalUserId: string | null;
    mintedAsPersonal: boolean;
    updatedAt: Date;
  };

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: new AllowEraseQueries(),
      logger: createLogger("langwatch:user-data-erase:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    adminId = (await prisma.user.create({ data: { name: "Admin", email: `a@${RUN}.test` } })).id;
    memberId = (await prisma.user.create({ data: { name: "Ada", email: `m@${RUN}.test` } })).id;
    otherMemberId = (await prisma.user.create({ data: { name: "Bo", email: `o@${RUN}.test` } })).id;
    const key = await prisma.virtualKey.create({
      data: unmarkedKey({ id: KEY_ID, createdById: adminId, principalUserId: memberId }),
    });
    editedAt = key.updatedAt.toISOString();
    otherKeyBefore = await prisma.virtualKey.create({
      data: unmarkedKey({ id: OTHER_KEY_ID, createdById: adminId, principalUserId: otherMemberId }),
      select: { principalUserId: true, mintedAsPersonal: true, updatedAt: true },
    });

    await PrismaGdprUserDataEraseRepository.create({
      database: prisma,
    }).eraseUserAndOwnedResources({
      userId: memberId,
      projectIds: [],
      soleOwnedTeamIds: [],
      soleOwnedOrgIds: [],
    });
  });

  afterAll(async () => {
    const prisma = connection.client;
    await prisma.virtualKey.deleteMany({ where: { id: { in: [KEY_ID, OTHER_KEY_ID] } } });
    await prisma.processManagerOutbox.deleteMany({ where: { tenantId: memberId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, memberId, otherMemberId] } } });
    await connection.closeOnce();
  });

  describe("when the member's account is erased", () => {
    /** @scenario "Erasing a user keeps the keys minted for them marked personal" */
    it("marks the key personal as its principal goes, and keeps its last edit time", async () => {
      const key = await connection.client.virtualKey.findUniqueOrThrow({
        where: { id: KEY_ID },
        select: { principalUserId: true, mintedAsPersonal: true, updatedAt: true },
      });

      expect({ ...key, updatedAt: key.updatedAt.toISOString() }).toEqual({
        principalUserId: null,
        mintedAsPersonal: true,
        updatedAt: editedAt,
      });
    });

    /** @scenario "Erasing a user keeps the keys minted for them marked personal" */
    it("leaves another member's unmarked key as it was", async () => {
      const otherKey = await connection.client.virtualKey.findUniqueOrThrow({
        where: { id: OTHER_KEY_ID },
        select: { principalUserId: true, mintedAsPersonal: true, updatedAt: true },
      });

      expect(otherKey).toEqual(otherKeyBefore);
    });
  });
});
