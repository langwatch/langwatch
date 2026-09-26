import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";

import { PrismaSsoConnectionIssuers } from "../sso-connection-issuers.prisma.repository";
import { migrationConnectionData } from "./sso-migration-evidence.fixture";

const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const organizationId = generate("organization").toString();
const domain = `${organizationId}.test`;
const legacyId = `${organizationId}-legacy`;
const directId = `${organizationId}-direct`;
const repository = new PrismaSsoConnectionIssuers(prisma);

beforeAll(async () => {
  await prisma.ssoConnection.createMany({
    data: [
      migrationConnectionData({ id: legacyId, organizationId, domain }),
      migrationConnectionData({
        id: directId,
        organizationId,
        domain,
        replacesConnectionId: legacyId,
      }),
    ],
  });
  await prisma.ssoProvider.createMany({
    data: [legacyId, directId].map((id) => ({
      id,
      providerId: id,
      organizationId,
      domain,
      issuer: `https://${id}.example.test`,
    })),
  });
  await prisma.ssoVerifiedDomain.create({
    data: {
      domain,
      organizationId,
      holders: {
        create: [legacyId, directId].map((connectionId) => ({
          connectionId,
        })),
      },
    },
  });
});
afterAll(async () => {
  await prisma.ssoVerifiedDomain.deleteMany({ where: { organizationId } });
  await prisma.ssoProvider.deleteMany({ where: { organizationId } });
  await prisma.ssoConnection.deleteMany({ where: { organizationId } });
  await prisma.$disconnect();
});

describe("domain-scoped issuer trust", () => {
  it("follows the migration route and adds no trust for unknown or suspended domains", async () => {
    expect(
      await repository.findIssuerForDomain({ domain: "unknown.test" }),
    ).toBeNull();
    expect(await repository.findIssuerForDomain({ domain })).toBe(
      `https://${directId}.example.test`,
    );
    await prisma.ssoConnection.update({
      where: { id: directId },
      data: { migrationPhase: "GRACE_LEGACY" },
    });
    expect(await repository.findIssuerForDomain({ domain })).toBe(
      `https://${legacyId}.example.test`,
    );
    await prisma.ssoConnection.update({
      where: { id: legacyId },
      data: { state: "SUSPENDED" },
    });
    expect(await repository.findIssuerForDomain({ domain })).toBeNull();
  });
});
