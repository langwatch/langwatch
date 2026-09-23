/**
 * @vitest-environment node
 * A license token on resolve-key, over real Postgres: the gateway judges it on the facts licensing
 * wrote onto the managed key, and never reads the registry. Spec:
 * specs/self-hosting/connected-services/license-credential.feature
 */
import { registryHashForToken } from "@langwatch/gateway-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TestProjectApi } from "../../__tests__/support/test-project-api.ts";
import { createGatewayTestPrismaConnection } from "../../app/__tests__/gateway-prisma.fixture.ts";
import { GatewayJwtService } from "../../services/gateway-jwt.service.ts";
import type { VirtualKeyService } from "../../services/virtual-key.service.ts";
import { PostgresVirtualKeyAdapter } from "../../testing.ts";
import {
  GATEWAY_INTERNAL_TEST_SECRET,
  mountGatewayInternalRest,
  signedGatewayRequest,
} from "./support/gateway-internal-rest.harness.ts";

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl ? createGatewayTestPrismaConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG_ID = `org-lwl-${suffix}`;
const USER_ID = `usr-lwl-${suffix}`;
const CUSTOMER_NAME = `ACME Rockets ${suffix}`;
const INSTANCE_ID = `instance-${suffix}`;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

let service: VirtualKeyService;
let app: ReturnType<typeof mountGatewayInternalRest>;

async function tokenFor(seed: string): Promise<string> {
  return `lwl_${await registryHashForToken(seed)}`;
}

async function resolve(body: Record<string, string>) {
  const res = await app.fetch(
    signedGatewayRequest({
      method: "POST",
      path: "/api/internal/gateway/resolve-key",
      body,
    }),
  );
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

function claimsOf(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
}

async function licensedKey({
  token,
  expiresAt,
  services = ["instant_evals"],
}: {
  token: string;
  expiresAt: Date;
  services?: string[];
}) {
  const { virtualKey } = await service.create({
    organizationId: ORG_ID,
    name: `Connect lic-${nanoid(6)}`,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
    actorUserId: USER_ID,
    purpose: "CONNECT",
  });
  await service.setConnectServicesInternal({
    id: virtualKey.id,
    organizationId: ORG_ID,
    services,
  });
  await service.setLicenseFactsInternal({
    id: virtualKey.id,
    organizationId: ORG_ID,
    tokenHash: await registryHashForToken(token),
    instanceId: INSTANCE_ID,
    expiresAt: fromDate(expiresAt),
  });
  return virtualKey;
}

describe.skipIf(!databaseUrl)("a license token on resolve-key (real PG + internal route)", () => {
  beforeAll(async () => {
    const projects = new TestProjectApi();
    service = PostgresVirtualKeyAdapter.createVirtualKeyServiceForTest(prisma, projects);
    app = mountGatewayInternalRest({
      virtualKeys: service,
      projects,
      jwt: GatewayJwtService.create({ secret: GATEWAY_INTERNAL_TEST_SECRET }),
      budgetSpend: undefined,
    });
    await prisma.organization.create({
      data: { id: ORG_ID, name: CUSTOMER_NAME, slug: `lwl-${suffix}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@lwl.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKeyScope.deleteMany({ where: { virtualKey: { organizationId: ORG_ID } } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  }, 60_000);

  describe("given a managed key licensing wrote an active license onto", () => {
    /** @scenario "A registered license resolves to the customer's managed key" */
    /** @scenario "The resolved license key carries the license's hosted services" */
    it("is accepted, attributed to the customer and carries the license's services", async () => {
      const token = await tokenFor(`accepted-${suffix}`);
      const expiresAt = new Date(Date.now() + YEAR_MS);
      const key = await licensedKey({ token, expiresAt });

      const { status, json } = await resolve({ key_presented: token, instance_id: INSTANCE_ID });

      expect(status).toBe(200);
      expect(json.key_id).toBe(key.id);
      const claims = claimsOf(json.jwt as string);
      expect(claims).toMatchObject({ org_id: ORG_ID, connect_services: ["instant_evals"] });
      expect(Number(claims.exp) * 1000).toBeLessThanOrEqual(expiresAt.getTime());
    });
  });

  describe("given a license entitled to no hosted service", () => {
    it("still answers with the claim, as an empty list", async () => {
      const token = await tokenFor(`entitled-to-nothing-${suffix}`);
      await licensedKey({ token, expiresAt: new Date(Date.now() + YEAR_MS), services: [] });

      const { status, json } = await resolve({ key_presented: token, instance_id: INSTANCE_ID });

      expect(status).toBe(200);
      expect(claimsOf(json.jwt as string)).toMatchObject({ connect_services: [] });
    });
  });

  describe("when calls present an unregistered token, a revoked one and one bound elsewhere", () => {
    /** @scenario "Refusals do not reveal license metadata" */
    it("answers each with its code and nothing about the customer or the term", async () => {
      const expiresAt = new Date(Date.now() + YEAR_MS);
      const revokedToken = await tokenFor(`revoked-${suffix}`);
      const revoked = await licensedKey({ token: revokedToken, expiresAt });
      await service.revokeManagedInternal({
        id: revoked.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });
      const elsewhereToken = await tokenFor(`elsewhere-${suffix}`);
      await licensedKey({ token: elsewhereToken, expiresAt });

      const refusals = [
        await resolve({
          key_presented: await tokenFor(`unknown-${suffix}`),
          instance_id: INSTANCE_ID,
        }),
        await resolve({ key_presented: revokedToken, instance_id: INSTANCE_ID }),
        await resolve({ key_presented: elsewhereToken, instance_id: "another-install" }),
      ];

      expect(
        refusals.map((r) => [r.status, (r.json.error as { code?: string } | undefined)?.code]),
      ).toEqual([
        [401, "connect_license_not_registered"],
        [403, "connect_license_revoked"],
        [403, "connect_wrong_instance"],
      ]);
      for (const { text } of refusals) {
        expect(text).not.toContain(CUSTOMER_NAME);
        expect(text).not.toContain(String(expiresAt.getUTCFullYear()));
      }
    });
  });

  describe("when a license token arrives without its instance id", () => {
    it("is refused as needing one", async () => {
      const token = await tokenFor(`no-instance-${suffix}`);
      await licensedKey({ token, expiresAt: new Date(Date.now() + YEAR_MS) });

      const { status, json } = await resolve({ key_presented: token });

      expect(status).toBe(400);
      expect((json.error as { code?: string }).code).toBe("connect_instance_required");
    });
  });

  describe("when the license term written on the key has ended", () => {
    it("is refused as expired", async () => {
      const token = await tokenFor(`expired-${suffix}`);
      await licensedKey({ token, expiresAt: new Date(Date.now() - 60_000) });

      const { status, json } = await resolve({ key_presented: token, instance_id: INSTANCE_ID });

      expect(status).toBe(403);
      expect((json.error as { code?: string }).code).toBe("connect_license_expired");
    });
  });
});
