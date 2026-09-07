import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaSsoConnectionRegistrationRepository } from "../sso-connection-registration.prisma.repository";

const namespace = `ssoreg-${nanoid(8)}`;
const organizationId = `${namespace}-org`;
const repository = new PrismaSsoConnectionRegistrationRepository(prisma);

afterEach(async () => {
  await prisma.ssoConnectionRegistrationSlot.deleteMany({
    where: { organizationId },
  });
  await prisma.ssoConnection.deleteMany({
    where: { organizationId },
  });
});

describe("PrismaSsoConnectionRegistrationRepository", () => {
  it("answers one holder to concurrent direct registration attempts", async () => {
    const claims = Array.from({ length: 8 }, (_, index) => ({
      organizationId,
      kind: "direct" as const,
      connectionId: `${namespace}-connection-${index}`,
      replacesConnectionId: null,
      commandId: `${namespace}-command-${index}`,
    }));

    const holders = await Promise.all(
      claims.map((claim) => repository.claim(claim)),
    );

    expect(new Set(holders.map((holder) => holder.connectionId)).size).toBe(1);
    expect(
      await prisma.ssoConnectionRegistrationSlot.count({
        where: { organizationId, kind: "direct" },
      }),
    ).toBe(1);
  });

  it("replaces a slot only after its projected connection is terminal", async () => {
    const first = {
      organizationId,
      kind: "direct" as const,
      connectionId: `${namespace}-first`,
      replacesConnectionId: `${namespace}-legacy`,
      commandId: `${namespace}-command-first`,
    };
    const second = {
      ...first,
      connectionId: `${namespace}-second`,
      commandId: `${namespace}-command-second`,
    };
    await repository.claim(first);

    expect(await repository.claim(second)).toMatchObject(first);
    await insertTerminalConnection(first.connectionId);
    expect(await repository.claim(second)).toMatchObject(second);
  });
});

async function insertTerminalConnection(connectionId: string): Promise<void> {
  const now = new Date();
  await prisma.ssoConnection.create({
    data: {
      id: connectionId,
      organizationId,
      type: "oidc",
      state: "DISCARDED",
      claimedDomains: [],
      approvedDomains: [],
      verifiedDomains: [],
      lapsedDomains: [],
      idpMetadata: {},
      source: "self-serve",
      occurredAt: now,
      lastEventId: `${namespace}-event`,
      acceptedAt: now,
      projectionVersion: "test",
      createdAt: now,
      updatedAt: now,
    },
  });
}
