/**
 * What the license-token route suites share: a signed internal request, the
 * registry wired to the real Postgres, and the rows one run leaves behind.
 */
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { licenseTokenFromKey } from "@ee/licensing/licenseToken";
import { PrismaConnectManagedKeys } from "@ee/licensing/registry/connectManagedKey.prisma";
import {
  PrismaCustomerOrganizations,
  PrismaIssuedLicenseRepository,
  PrismaLicenseSeatReports,
} from "@ee/licensing/registry/issuedLicense.prisma";
import { LicenseRegistryService } from "@ee/licensing/registry/licenseRegistry.service";
import { nanoid } from "nanoid";
import { prisma } from "~/server/db";
import { app } from "../../gateway-internal";

const RESOLVE_KEY_PATH = "/api/internal/gateway/resolve-key";

export function licenseTokenHarness() {
  const suffix = nanoid(8);
  const userId = `usr-lwl-${suffix}`;
  const customerName = `ACME Rockets ${suffix}`;
  const signingSecret = randomBytes(16).toString("hex");
  const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const previous: Record<string, string | undefined> = {};
  const organizationIds: string[] = [];

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const registry = new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    seatReports: new PrismaLicenseSeatReports(prisma),
    organizations: new PrismaCustomerOrganizations(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    contractBudgets: { sync: async () => undefined },
    signingKey: () => privateKey,
    publicKey,
    encrypt: (plain) => `enc:${plain.length}`,
  });

  function signedResolveKey(body: Record<string, string>) {
    const payload = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyHash = createHash("sha256").update(payload).digest("hex");
    const signature = createHmac("sha256", signingSecret)
      .update(`POST\n${RESOLVE_KEY_PATH}\n${timestamp}\n${bodyHash}`)
      .digest("hex");
    return new Request(`http://localhost${RESOLVE_KEY_PATH}`, {
      method: "POST",
      body: payload,
      headers: {
        "Content-Type": "application/json",
        "X-LangWatch-Gateway-Signature": signature,
        "X-LangWatch-Gateway-Timestamp": timestamp,
      },
    });
  }

  return {
    /** Every row this run creates carries it, so two runs never collide. */
    suffix,
    userId,
    nextYear,
    organizationIds,

    async resolve(body: Record<string, string>) {
      const res = await app.request(signedResolveKey(body));
      const text = await res.text();
      const json = JSON.parse(text) as {
        jwt?: string;
        key_id?: string;
        error?: { code?: string };
      };
      return { status: res.status, text, json };
    },

    claimsOf(jwt: string): Record<string, unknown> {
      const payload = jwt.split(".")[1] ?? "";
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    },

    /** A license for a customer of this run, with the token its install holds. */
    async issue(seats = 50) {
      const { licenseKey, license } = await registry.issue({
        customer: { newOrganizationName: customerName },
        email: "ops@acme.test",
        planType: "ENTERPRISE",
        maxMembers: seats,
        expiresAt: nextYear,
        operatorId: userId,
      });
      organizationIds.push(license.organizationId as string);
      return {
        id: license.id,
        organizationId: license.organizationId as string,
        token: licenseTokenFromKey(licenseKey) as string,
      };
    },

    registry,

    async start() {
      for (const name of [
        "LW_GATEWAY_INTERNAL_SECRET",
        "LW_GATEWAY_JWT_SECRET",
      ]) {
        previous[name] = process.env[name];
        process.env[name] = signingSecret;
      }
      await prisma.user.create({
        data: { id: userId, email: `${suffix}@lwl.local`, name: "Operator" },
      });
    },

    async stop() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      const inOrganizations = { organizationId: { in: organizationIds } };
      await prisma.issuedLicense.deleteMany({ where: inOrganizations });
      await prisma.gatewayChangeEvent.deleteMany({ where: inOrganizations });
      const keys = await prisma.virtualKey.findMany({
        where: inOrganizations,
        select: { id: true },
      });
      await prisma.virtualKeyScope.deleteMany({
        where: { virtualKeyId: { in: keys.map((key) => key.id) } },
      });
      await prisma.virtualKey.deleteMany({ where: inOrganizations });
      for (const organizationId of organizationIds) {
        await prisma.modelProvider.deleteMany({ where: { organizationId } });
      }
      await prisma.auditLog.deleteMany({ where: inOrganizations });
      await prisma.project.deleteMany({ where: { team: inOrganizations } });
      await prisma.team.deleteMany({ where: inOrganizations });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await prisma.user.deleteMany({ where: { id: userId } });
    },
  };
}
