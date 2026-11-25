/**
 * @vitest-environment node
 * Real Postgres: the change feed's cursor never passes a revision still uncommitted.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGatewayTestPrismaConnection } from "../../../app/__tests__/gateway-prisma.fixture.ts";
import { PrismaGatewayChangeEventsRepository } from "../prisma.gateway-change-event.repository.ts";

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl ? createGatewayTestPrismaConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

const ORG_ID = `org-feed-${nanoid(8)}`;

describe.skipIf(!databaseUrl)("the gateway change feed", () => {
  beforeAll(async () => {
    await prisma.organization.create({ data: { id: ORG_ID, name: ORG_ID, slug: ORG_ID } });
  });

  afterAll(async () => {
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await connection?.closeOnce();
  });

  it("holds a later change back until an earlier one in the same organization commits", async () => {
    const changes = PrismaGatewayChangeEventsRepository.create(prisma);
    let commitRevoke = (): void => undefined;
    const revokeHeld = new Promise<void>((resolve) => {
      commitRevoke = resolve;
    });
    let revokeAppended = (): void => undefined;
    const revokeIn = new Promise<void>((resolve) => {
      revokeAppended = resolve;
    });

    const revoke = prisma.$transaction(async (tx) => {
      const appended = await changes.append({ organizationId: ORG_ID, kind: "VK_REVOKED" }, tx);
      revokeAppended();
      await revokeHeld;
      return appended;
    });
    await revokeIn;
    const later = changes.append({ organizationId: ORG_ID, kind: "VK_CREATED" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect((await changes.since(ORG_ID, 0n)).events).toEqual([]);

    commitRevoke();
    const [first, second] = await Promise.all([revoke, later]);
    const { events } = await changes.since(ORG_ID, 0n);

    expect(second.revision).toBeGreaterThan(first.revision);
    expect(events.map((event) => event.kind)).toEqual(["VK_REVOKED", "VK_CREATED"]);
  });
});
