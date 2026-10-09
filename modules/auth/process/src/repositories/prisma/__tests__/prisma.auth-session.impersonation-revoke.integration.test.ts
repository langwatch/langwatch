/**
 * The one revoke at deploy: the blocking inline DML main shipped in the identity_auth migration,
 * run as written against Session rows, ends the legacy impersonation sessions and no other.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAuthSessionRepository } from "../prisma.auth-session.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const MIGRATION = new URL(
  "../../../../../../../packages/prisma-client/prisma/migrations/20260913120001_identity_auth/migration.sql",
  import.meta.url,
);
const namespace = `test-auth-impersonation-revoke-${randomUUID()}`;
const operatorId = `${namespace}-operator`;
const memberId = `${namespace}-member`;
const legacySessionId = `${namespace}-legacy`;
const ordinarySessionId = `${namespace}-ordinary`;

/** The migration's revoke block, exactly as it ships: the first `DO $$ … END $$;` in the file. */
async function deployRevoke(): Promise<string> {
  const [block] = /DO \$\$[\s\S]*?END \$\$;/.exec(await readFile(MIGRATION, "utf8")) ?? [];
  if (!block?.includes(`DELETE FROM "Session"`)) throw new Error("the revoke block moved");

  // Migrations run outside the tenancy guard; the test's client runs inside it.
  return `-- @tenancy: a deploy migration spans every tenant\n${block}`;
}

describe.skipIf(!databaseUrl)("the impersonation revoke at deploy", () => {
  let connection: PrismaConnection;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:impersonation-revoke"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;

    for (const id of [operatorId, memberId]) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
    }
    const expires = new Date("2030-01-01T00:00:00.000Z");
    await prisma.session.create({
      data: {
        id: legacySessionId,
        sessionToken: `${namespace}-legacy-token`,
        userId: operatorId,
        expires,
        impersonating: { id: memberId, name: memberId, email: `${memberId}@example.com` },
      },
    });
    await prisma.session.create({
      data: {
        id: ordinarySessionId,
        sessionToken: `${namespace}-token`,
        userId: memberId,
        expires,
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    const ids = [operatorId, memberId];
    await connection.client.session.deleteMany({ where: { userId: { in: ids } } });
    await connection.client.user.deleteMany({ where: { id: { in: ids } } });
    await connection.closeOnce();
  });

  describe("given legacy impersonation sessions beside ordinary ones", () => {
    describe("when the deliverable is deployed, and deployed again", () => {
      /** @scenario "The one revoke at deploy is the impersonating sessions" */
      it("ends the sessions carrying the legacy payload and keeps every ordinary session", async () => {
        const prisma = connection.client;
        const revoke = await deployRevoke();

        await prisma.$executeRawUnsafe(revoke);
        await prisma.$executeRawUnsafe(revoke);

        const left = await prisma.session.findMany({
          where: { id: { in: [legacySessionId, ordinarySessionId] } },
          select: { id: true },
        });
        expect(left).toEqual([{ id: ordinarySessionId }]);
        expect(await prisma.user.count({ where: { id: operatorId } })).toBe(1);
      });

      /** @scenario "The one revoke at deploy is the impersonating sessions" */
      it("keeps the legacy column for one release while auth writes only the claim columns", async () => {
        const prisma = connection.client;
        const repository = PrismaAuthSessionRepository.create({ prisma });

        await repository.writeImpersonation({
          sessionId: ordinarySessionId,
          claims: {
            actorUserId: memberId,
            subjectUserId: operatorId,
            reason: "Ticket 42",
            expiresAt: Temporal.Instant.from("2029-01-01T01:00:00.000Z"),
          },
        });

        const row = await prisma.session.findUniqueOrThrow({ where: { id: ordinarySessionId } });
        expect(row).toMatchObject({ actorUserId: memberId, impersonating: null });
        await repository.clearImpersonation({ sessionId: ordinarySessionId });
      });
    });
  });
});
