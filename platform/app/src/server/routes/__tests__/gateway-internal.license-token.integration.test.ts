/**
 * @vitest-environment node
 *
 * A license token on the gateway's key resolution route, against real Postgres:
 * it resolves to a managed key on the customer organization, a virtual key is
 * resolved exactly as before, and revoking the license writes the change that
 * evicts a gateway's cached credential.
 *
 * Spec: specs/self-hosting/connected-services/license-credential.feature
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { eligibleModelProvidersForVk } from "~/server/gateway/scopeResolver";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { app } from "../gateway-internal";

const suffix = nanoid(8);
const USER_ID = `usr-lwl-${suffix}`;
const CUSTOMER_NAME = `ACME Rockets ${suffix}`;
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
  const text = await res.text();
  const json = JSON.parse(text) as {
    jwt?: string;
    key_id?: string;
    error?: { code?: string };
  };
  return { status: res.status, text, json };
}

function claimsOf(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("a license token on resolve-key (real PG + internal route)", () => {
  const previous: Record<string, string | undefined> = {};
  const organizationIds: string[] = [];
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

  const issue = async (seats = 50) => {
    const { licenseKey, license } = await registry.issue({
      customer: { newOrganizationName: CUSTOMER_NAME },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: seats,
      expiresAt: NEXT_YEAR,
      operatorId: USER_ID,
    });
    organizationIds.push(license.organizationId as string);
    return {
      id: license.id,
      organizationId: license.organizationId as string,
      token: licenseTokenFromKey(licenseKey) as string,
    };
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
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@lwl.local`, name: "Operator" },
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
    for (const organizationId of organizationIds) {
      await prisma.modelProvider.deleteMany({ where: { organizationId } });
    }
    await prisma.auditLog.deleteMany({ where: inOrganizations });
    await prisma.project.deleteMany({ where: { team: inOrganizations } });
    await prisma.team.deleteMany({ where: inOrganizations });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  });

  describe("given an active license registered to a customer with no team or project", () => {
    describe("when the install's token is resolved with its instance id", () => {
      /** @scenario A registered license resolves to the customer's managed key */
      /** @scenario Forwarded calls are metered under the customer organization */
      it("is accepted and attributed to the customer organization", async () => {
        const license = await issue();

        const { status, json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });

        expect(status).toBe(200);
        expect(claimsOf(json.jwt as string)).toMatchObject({
          org_id: license.organizationId,
          vk_id: json.key_id,
        });
        const key = await prisma.virtualKey.findUnique({
          where: { id: json.key_id as string },
        });
        expect(key).toMatchObject({
          organizationId: license.organizationId,
          purpose: "CONNECT",
          status: "ACTIVE",
        });
        expect(key?.traceProjectId).toBeTruthy();
      });

      it("ends the signed token with the license term at the latest", async () => {
        const license = await issue();

        const { json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });

        const { exp } = claimsOf(json.jwt as string) as { exp: number };
        expect(exp * 1000).toBeLessThanOrEqual(NEXT_YEAR.getTime());
      });
    });

    describe("when a customer admin looks for the managed key", () => {
      /** @scenario The managed key is not visible or editable as a customer key */
      it("is absent from the list and refuses a customer revoke", async () => {
        const license = await issue();
        const { json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });
        const service = VirtualKeyService.create(prisma);

        expect(await service.getAll(license.organizationId)).toEqual([]);
        expect(
          await service.getById(json.key_id as string, license.organizationId),
        ).toBeNull();
        await expect(
          service.revoke({
            id: json.key_id as string,
            organizationId: license.organizationId,
            actorUserId: USER_ID,
          }),
        ).rejects.toThrow();
      });

      /** @scenario A license token reaches none of the customer's own model providers */
      it("reaches none of the customer organization's own model providers", async () => {
        const license = await issue();
        const { json } = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });
        const provider = await prisma.modelProvider.create({
          data: {
            organizationId: license.organizationId,
            name: "OpenAI",
            provider: "openai",
            enabled: true,
            scopes: {
              create: {
                scopeType: "ORGANIZATION",
                scopeId: license.organizationId,
              },
            },
          },
        });
        const service = VirtualKeyService.create(prisma);
        const managed = await service.getManagedByIdInternal(
          json.key_id as string,
          license.organizationId,
        );
        if (!managed) throw new Error("expected the managed key");
        // The same scope on a customer key does reach the provider, so an
        // empty answer for the managed key is the rule and not a missing row.
        const { virtualKey: customerKey } = await service.create({
          organizationId: license.organizationId,
          name: `customer-${nanoid(6)}`,
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: license.organizationId },
          ],
          traceProjectId: managed.traceProjectId,
          actorUserId: USER_ID,
        });

        expect(
          (await eligibleModelProvidersForVk(prisma, customerKey)).map(
            (mp) => mp.id,
          ),
        ).toEqual([provider.id]);
        expect(await eligibleModelProvidersForVk(prisma, managed)).toEqual([]);
      });
    });

    describe("when the license is revoked after a gateway resolved it", () => {
      /** @scenario Revoking a license revokes its managed key */
      it("ends the key, writes the change gateways evict on, and refuses the token", async () => {
        const license = await issue();
        const first = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });

        await registry.revoke({
          id: license.id,
          operatorId: USER_ID,
          reason: "leaked",
        });

        expect(
          await prisma.gatewayChangeEvent.findFirst({
            where: {
              organizationId: license.organizationId,
              kind: "VK_REVOKED",
              virtualKeyId: first.json.key_id as string,
            },
          }),
        ).not.toBeNull();
        const after = await resolve({
          key_presented: license.token,
          instance_id: "instance-a",
        });
        expect(after.status).toBe(403);
        expect(after.json.error?.code).toBe("connect_license_revoked");
      });
    });

    describe("when calls present an unregistered token, a revoked one and one bound elsewhere", () => {
      /** @scenario Refusals do not reveal whether a license exists */
      it("answers with a code and nothing about the customer, the seats or the term", async () => {
        const revoked = await issue(73);
        await registry.revoke({
          id: revoked.id,
          operatorId: USER_ID,
          reason: "leaked",
        });
        const bound = await issue(73);
        await resolve({
          key_presented: bound.token,
          instance_id: "instance-a",
        });

        const refusals = await Promise.all([
          resolve({
            key_presented: `lwl_${"0".repeat(64)}`,
            instance_id: "instance-a",
          }),
          resolve({ key_presented: revoked.token, instance_id: "instance-a" }),
          resolve({ key_presented: bound.token, instance_id: "instance-b" }),
          resolve({ key_presented: bound.token }),
        ]);

        expect(refusals.map((r) => [r.status, r.json.error?.code])).toEqual([
          [401, "connect_license_not_registered"],
          [403, "connect_license_revoked"],
          [403, "connect_wrong_instance"],
          [400, "connect_instance_required"],
        ]);
        for (const { text } of refusals) {
          expect(text).not.toContain("ACME");
          expect(text).not.toContain("73");
          expect(text).not.toContain(String(NEXT_YEAR.getFullYear()));
        }
      });
    });
  });

  describe("given a Cloud project with a virtual key", () => {
    /** @scenario A virtual key keeps working next to the license token */
    it("resolves the virtual key exactly as before", async () => {
      const organization = await prisma.organization.create({
        data: { name: `VK Org ${suffix}`, slug: `lwl-vk-${suffix}` },
      });
      organizationIds.push(organization.id);
      const team = await prisma.team.create({
        data: {
          name: "Team",
          slug: `lwl-vk-team-${suffix}`,
          organizationId: organization.id,
        },
      });
      const project = await prisma.project.create({
        data: {
          name: "Project",
          slug: `lwl-vk-proj-${suffix}`,
          teamId: team.id,
          language: "en",
          framework: "openai",
          apiKey: `lwl-vk-key-${suffix}`,
        },
      });
      const { secret, virtualKey } = await VirtualKeyService.create(
        prisma,
      ).create({
        organizationId: organization.id,
        name: `key-${suffix}`,
        scopes: [{ scopeType: "PROJECT", scopeId: project.id }],
        actorUserId: USER_ID,
      });

      const { status, json } = await resolve({ key_presented: secret });

      expect(status).toBe(200);
      expect(json.key_id).toBe(virtualKey.id);
      expect(claimsOf(json.jwt as string)).toMatchObject({
        org_id: organization.id,
        project_id: project.id,
      });
    });
  });
});
