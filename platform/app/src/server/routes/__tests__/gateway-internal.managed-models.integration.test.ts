/**
 * @vitest-environment node
 *
 * Managed models on LangWatch Cloud, against real Postgres: the resolve-key
 * answer names the services the license is entitled to, and the configuration
 * of its managed key carries the platform's own providers, or none where the
 * contract does not include the service.
 *
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 */

import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import type { ConnectService } from "@ee/licensing/connect/services";
import { licenseTokenFromKey } from "@ee/licensing/licenseToken";
import { PrismaConnectManagedKeys } from "@ee/licensing/registry/connectManagedKey.prisma";
import {
  PrismaCustomerOrganizations,
  PrismaIssuedLicenseRepository,
} from "@ee/licensing/registry/issuedLicense.prisma";
import { LicenseRegistryService } from "@ee/licensing/registry/licenseRegistry.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayConfigMaterialiser } from "~/server/gateway/config.materialiser";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { app } from "../gateway-internal";

const suffix = nanoid(8);
const USER_ID = `usr-lwmm-${suffix}`;
const SIGNING_SECRET = randomBytes(16).toString("hex");
const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function signedResolveKey(body: Record<string, string>) {
  const path = "/api/internal/gateway/resolve-key";
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update(payload).digest("hex");
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(`POST\n${path}\n${timestamp}\n${bodyHash}`)
    .digest("hex");
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: payload,
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
  });
}

async function resolve(body: Record<string, string>) {
  const res = await app.request(signedResolveKey(body));
  const json = (await res.json()) as { jwt?: string; key_id?: string };
  return { status: res.status, json };
}

function claimsOf(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("managed models on a license token (real PG + internal route)", () => {
  const previous: Record<string, string | undefined> = {};
  const organizationIds: string[] = [];
  const registry = new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    seatBilling: { invoiceAddedSeats: async () => "not_onboarded" },
    organizations: new PrismaCustomerOrganizations(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    contractBudgets: { sync: async () => undefined },
    signingKey: () => privateKey,
    publicKey,
    encrypt: (plain) => `enc:${plain.length}`,
  });

  const issue = async (services: ConnectService[]) => {
    const { licenseKey, license } = await registry.issue({
      customer: { newOrganizationName: `Customer ${nanoid(6)}` },
      email: "ops@example.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: NEXT_YEAR,
      terms: { services },
      operatorId: USER_ID,
    });
    organizationIds.push(license.organizationId as string);
    return {
      organizationId: license.organizationId as string,
      token: licenseTokenFromKey(licenseKey) as string,
    };
  };

  /** The managed key the token resolves to, with its scopes, for the materialiser. */
  const managedKeyOf = async (license: {
    organizationId: string;
    token: string;
  }) => {
    const { json } = await resolve({
      key_presented: license.token,
      instance_id: `instance-${nanoid(6)}`,
    });
    const key = await VirtualKeyService.create(prisma).getManagedByIdInternal(
      json.key_id as string,
      license.organizationId,
    );
    if (!key) throw new Error("expected the managed key");
    return { key, claims: claimsOf(json.jwt as string) };
  };

  beforeAll(async () => {
    await startTestContainers();
    for (const name of [
      "LW_GATEWAY_INTERNAL_SECRET",
      "LW_GATEWAY_JWT_SECRET",
    ]) {
      previous[name] = process.env[name];
      process.env[name] = SIGNING_SECRET;
    }
    previous.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-platform-openai";
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@lwmm.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
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
    await prisma.auditLog.deleteMany({ where: inOrganizations });
    await prisma.project.deleteMany({ where: { team: inOrganizations } });
    await prisma.team.deleteMany({ where: inOrganizations });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  });

  describe("given a license entitled to managed models", () => {
    describe("when a gateway resolves its token", () => {
      /** @scenario The resolved license key carries the license's hosted services */
      it("names the services on the signed answer", async () => {
        const license = await issue(["instant_evals", "managed_models"]);

        const { claims } = await managedKeyOf(license);

        expect(claims.connect_services).toEqual([
          "instant_evals",
          "managed_models",
        ]);
      });

      /** @scenario The configuration of an entitled license key lists the platform's shared providers */
      it("carries the platform's shared providers in the key's configuration", async () => {
        const entitled = await issue(["managed_models"]);
        const unentitled = await issue(["instant_evals"]);
        const materialiser = new GatewayConfigMaterialiser(prisma);

        const config = await materialiser.materialise(
          (await managedKeyOf(entitled)).key,
        );
        const without = await materialiser.materialise(
          (await managedKeyOf(unentitled)).key,
        );

        expect(config.providers.map((slot) => slot.type)).toContain("openai");
        expect(config.providers.map((slot) => slot.id)).toEqual(
          config.fallback.chain,
        );
        expect(without.providers).toEqual([]);
      });
    });
  });

  describe("given a license entitled to nothing", () => {
    it("still answers with the claim, as an empty list", async () => {
      const license = await issue([]);

      const { claims } = await managedKeyOf(license);

      expect(claims.connect_services).toEqual([]);
    });
  });
});
