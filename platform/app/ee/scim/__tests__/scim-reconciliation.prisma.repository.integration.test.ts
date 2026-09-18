import { generate } from "@langwatch/ksuid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";

import { PrismaScimReconciliationRepository } from "../scim-reconciliation.prisma.repository";

const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const organizationId = generate("organization").toString();
const otherOrganizationId = generate("organization").toString();
const repository = new PrismaScimReconciliationRepository(prisma);

afterAll(async () => {
  await prisma.grant.deleteMany({
    where: { organizationId: { in: [organizationId, otherOrganizationId] } },
  });
  await prisma.$disconnect();
});

describe("directory-caused changes", () => {
  /** @scenario "Recent directory removals survive a full page of live grants" */
  it("orders by the later timestamp before capping, without duplicates or other tenants", async () => {
    const grant = (
      id: string,
      occurredAt: number,
      revokedAt: number | null = null,
    ) => ({
      id: `${organizationId}-${id}`,
      organizationId,
      principalType: "USER" as const,
      principalId: "person",
      roleKey: "member",
      scopeType: "ORGANIZATION" as const,
      scopeId: organizationId,
      source: "scim",
      occurredAt: new Date(occurredAt),
      revokedAt: revokedAt === null ? null : new Date(revokedAt),
    });
    await prisma.grant.createMany({
      data: [
        ...Array.from({ length: 50 }, (_, index) =>
          grant(`active-${index}`, 1000 + index),
        ),
        grant("old-attachment-new-removal", 1, 3000),
        grant("new-attachment-older-removal", 4000, 2000),
        { ...grant("foreign", 9000), organizationId: otherOrganizationId },
        { ...grant("manual", 8000), source: "grants-service" },
      ],
    });

    const changes = await repository.findDirectoryCausedChanges({
      organizationId,
      limit: 50,
    });

    expect(changes).toHaveLength(50);
    expect(changes.slice(0, 2)).toEqual([
      expect.objectContaining({
        grantId: `${organizationId}-new-attachment-older-removal`,
        kind: "removed",
        occurredAtMs: 4000,
      }),
      expect.objectContaining({
        grantId: `${organizationId}-old-attachment-new-removal`,
        kind: "removed",
        occurredAtMs: 3000,
      }),
    ]);
    expect(new Set(changes.map((change) => change.grantId)).size).toBe(50);
    expect(
      changes.some(
        (change) =>
          change.grantId.endsWith("foreign") ||
          change.grantId.endsWith("manual"),
      ),
    ).toBe(false);
  });
});
