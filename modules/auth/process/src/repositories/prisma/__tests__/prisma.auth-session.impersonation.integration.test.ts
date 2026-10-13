/**
 * The {actor, subject} claims round-trip through the real Session columns (D06): written by
 * auth alone, read back as the subject with the operator beside them, cleared without ending
 * the session. @see specs/identity/mfa-and-session-shape.feature
 */
import { randomUUID } from "node:crypto";

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
const namespace = `test-auth-impersonation-${randomUUID()}`;
const operatorId = `${namespace}-operator`;
const subjectId = `${namespace}-sam`;
const sessionId = `${namespace}-session`;

describe.skipIf(!databaseUrl)("Prisma auth session impersonation claims", () => {
  let connection: PrismaConnection;
  let repository: PrismaAuthSessionRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:impersonation"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaAuthSessionRepository.create({ prisma });

    for (const id of [operatorId, subjectId]) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
    }
    await prisma.session.create({
      data: {
        id: sessionId,
        sessionToken: `${namespace}-token`,
        userId: operatorId,
        expires: new Date("2030-01-01T00:00:00.000Z"),
        amr: ["pwd", "otp"],
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.session.deleteMany({ where: { userId: operatorId } });
    await connection.client.user.deleteMany({ where: { id: { in: [operatorId, subjectId] } } });
    await connection.closeOnce();
  });

  it("writes both people to the claim columns and reads them back", async () => {
    const expiresAt = Temporal.Instant.from("2029-01-01T01:00:00.000Z");

    await repository.writeImpersonation({
      sessionId,
      claims: { actorUserId: operatorId, subjectUserId: subjectId, reason: "Ticket 42", expiresAt },
    });

    const row = await connection.client.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row).toMatchObject({
      userId: operatorId,
      actorUserId: operatorId,
      subjectUserId: subjectId,
      impersonationReason: "Ticket 42",
      impersonationExpiresAt: new Date("2029-01-01T01:00:00.000Z"),
      impersonating: null,
      amr: ["pwd", "otp"],
    });
    await expect(repository.findById({ id: sessionId })).resolves.toMatchObject({
      impersonation: { actorUserId: operatorId, subjectUserId: subjectId, reason: "Ticket 42" },
    });
  });

  it("clears the claims and keeps the session", async () => {
    await repository.clearImpersonation({ sessionId });
    await repository.clearImpersonation({ sessionId });

    await expect(repository.findById({ id: sessionId })).resolves.toMatchObject({
      id: sessionId,
      impersonation: null,
    });
  });
});
