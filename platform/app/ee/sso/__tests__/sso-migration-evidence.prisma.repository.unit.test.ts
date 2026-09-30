import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { PrismaClient } from "~/generated/prisma/client";
import { PrismaSsoMigrationEvidenceRepository } from "../sso-migration-evidence.prisma.repository";
import { migrationConnectionRow } from "./sso-migration-evidence.fixture";

function fixture() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: "postgresql://test:test@127.0.0.1:1/test",
    }),
  });
  const findConnection = vi
    .spyOn(prisma.ssoConnection, "findFirst")
    .mockRejectedValue(new Error("Unexpected connection query"));
  const repository = PrismaSsoMigrationEvidenceRepository.create({
    prisma,
    recovery: {
      hasLiveBinding: async () => true,
      reserveActivationRecovery: async () => true,
    },
    holdsPassword: async () => true,
  });
  return { repository, findConnection };
}

describe("given migration evidence with no matching tenant-scoped pair", () => {
  it("scopes the requested replacement before reading any operational evidence", async () => {
    const { repository, findConnection } = fixture();
    findConnection.mockResolvedValueOnce(null);

    await expect(
      repository.getProgress({
        organizationId: "org_acme",
        connectionId: "direct",
        cursor: null,
        limit: 25,
      }),
    ).resolves.toBeNull();

    expect(findConnection).toHaveBeenCalledExactlyOnceWith({
      where: {
        organizationId: "org_acme",
        id: "direct",
        replacesConnectionId: { not: null },
        migrationPhase: { not: null },
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("requires the predecessor to belong to the same organization before finalization", async () => {
    const { repository, findConnection } = fixture();
    findConnection
      .mockResolvedValueOnce(migrationConnectionRow())
      .mockResolvedValueOnce(null);

    await expect(
      repository.inspect({
        organizationId: "org_acme",
        replacementConnectionId: "direct",
      }),
    ).resolves.toBeNull();

    expect(findConnection).toHaveBeenCalledTimes(2);
    expect(findConnection).toHaveBeenLastCalledWith({
      where: {
        id: "legacy",
        organizationId: "org_acme",
        source: "legacy-grandfathered",
      },
    });
  });
});
