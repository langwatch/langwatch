import { migrationConnectionData } from "@ee/sso/__tests__/sso-migration-evidence.fixture";
import { LegacySsoDomainRoutingRepository } from "@ee/sso/legacy-sso-domain.prisma.repository";
import { SsoConnectionDomainRoutingRepository } from "@ee/sso/sso-connection-routing.prisma.repository";
import { SignInRouterService } from "@langwatch/identity-server";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { hooksOver, userRow } from "./support/hooks.fixture";

const namespace = `native-social-${nanoid(10).toLowerCase()}`;
const organizationId = `${namespace}-org`;
const connectionId = `${namespace}-connection`;
const domain = `${namespace}.test`;
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const connections = new SsoConnectionDomainRoutingRepository(
  prisma,
  async () => true,
);
const domains = {
  connections,
  legacy: new LegacySsoDomainRoutingRepository(prisma, async () => null),
};
const router = new SignInRouterService({
  domains,
  policy: {
    resolvePolicy: async () => ({
      defaultMethods: [
        { id: "password", kind: "password", connectionId: null },
      ],
      localMethods: [{ id: "password", kind: "password", connectionId: null }],
      federationLicensed: true,
      selfHosted: true,
    }),
  },
  breakGlass: { allow: async () => false },
  accounts: { findAccountMethods: async () => null },
});

function hookFor(email: string) {
  const fixture = hooksOver({ user: userRow({ email }), accountCount: 1 });
  fixture.connectionGoverning.mockImplementation(async ({ email: address }) => {
    const decision = await router.route({ identifier: address });
    if (decision.outcome !== "redirect_to_connection") return null;
    const selected = decision.methodSet.find(
      (method) => method.connectionId !== null,
    );
    return selected?.connectionId
      ? { connectionId: selected.connectionId }
      : null;
  });
  return fixture.hooks;
}

const googleAccount = {
  userId: "user_1",
  providerId: "google",
  accountId: "google-subject",
};

beforeEach(async () => {
  await prisma.organization.create({
    data: { id: organizationId, name: namespace, slug: namespace },
  });
  await prisma.ssoConnection.create({
    data: {
      ...migrationConnectionData({ id: connectionId, organizationId, domain }),
      source: "self-serve",
      idpMetadata: { providerId: "Acme" },
      domainVerifications: [proof("VERIFIED")],
    },
  });
  await prisma.ssoVerifiedDomain.create({ data: { domain, organizationId } });
  await prisma.ssoVerifiedDomainHolder.create({
    data: { domain, organizationId, connectionId },
  });
});

afterEach(async () => {
  await prisma.ssoVerifiedDomainHolder.deleteMany({
    where: { organizationId },
  });
  await prisma.ssoVerifiedDomain.deleteMany({ where: { organizationId } });
  await prisma.ssoConnection.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
});
afterAll(async () => prisma.$disconnect());

function proof(proofState: "VERIFIED" | "LAPSED") {
  return {
    domain,
    method: "dns-txt",
    tokenHash: "sha256:published-proof",
    verifiedAtMs: new Date("2026-09-01T00:00:00Z").getTime(),
    proofState,
    firstAbsentAtMs:
      proofState === "LAPSED"
        ? new Date("2026-09-02T00:00:00Z").getTime()
        : null,
    graceEndsAtMs:
      proofState === "LAPSED"
        ? new Date("2026-09-04T00:00:00Z").getTime()
        : null,
  };
}

describe("native social account creation against persisted SSO domain routing", () => {
  /** @scenario "A domain the connection never proved is not the connection's" */
  it("allows an address outside the active connection's proved domain", async () => {
    expect(await connections.findConnectionForDomain({ domain })).toMatchObject(
      {
        connectionId,
        state: "ACTIVE",
        allowsJit: true,
      },
    );

    const hooks = hookFor(`sam@outside-${domain}`);
    await expect(
      hooks.beforeAccountCreate({ account: googleAccount }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "A connection still being set up governs nobody" */
  it("allows Google while a proved connection is VERIFIED but not ACTIVE", async () => {
    await prisma.ssoConnection.update({
      where: { id: connectionId },
      data: { state: "VERIFIED" },
    });
    expect(await connections.findConnectionForDomain({ domain })).toMatchObject(
      {
        connectionId,
        state: "INACTIVE",
        allowsJit: true,
      },
    );

    const hooks = hookFor(`sam@${domain}`);
    await expect(
      hooks.beforeAccountCreate({ account: googleAccount }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "A domain whose proof has lapsed still sends them to the provider" */
  it("refuses Google and names the active connection after its actual proof lapses", async () => {
    await prisma.ssoConnection.update({
      where: { id: connectionId },
      data: { lapsedDomains: [domain], domainVerifications: [proof("LAPSED")] },
    });
    expect(await connections.findConnectionForDomain({ domain })).toMatchObject(
      {
        connectionId,
        state: "ACTIVE",
        allowsJit: false,
      },
    );

    const hooks = hookFor(`sam@${domain}`);
    await expect(
      hooks.beforeAccountCreate({ account: googleAccount }),
    ).rejects.toMatchObject({
      body: { code: "SSO_REQUIRED_BY_ORGANIZATION", message: connectionId },
    });
  });
});
