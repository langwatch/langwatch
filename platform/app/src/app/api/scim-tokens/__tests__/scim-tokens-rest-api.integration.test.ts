/**
 * @vitest-environment node
 *
 * @see specs/organizations/scim-tokens-rest-api.feature
 *
 * SCIM bearer tokens over REST. The token is the credential an identity
 * provider will hold, so the plaintext exists exactly once, in the create
 * response; the suite proves it by driving the real SCIM surface with the
 * minted value before and after revocation.
 */
import crypto from "node:crypto";
import { appContextBindingsFor } from "~/app/api/middleware/app-context";
import { app as scimApp } from "~/server/enterprise/scim/routes";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { MANAGEMENT_API_VERSION } from "@langwatch/platform-api/app-rest";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  ENTERPRISE_TEST_PLAN,
  type ManagementTestOrg,
  seedManagementOrg,
} from "~/test-utils/managementApiOrg";
import { seedSsoConnection } from "~/test-utils/ssoConnection";
import { getApp } from "~/server/app-layer/app";
import { createScimTokensRestApp } from "@langwatch/platform-api";
import { requireEnterprisePlanRest } from "~/app/api/middleware/enterprise-gate";
import { appRestSecurity } from "~/server/api/security";
import { managementAuditPort } from "~/server/api/management/audit";

const app = createScimTokensRestApp({
  security: appRestSecurity,
  enterpriseGate: requireEnterprisePlanRest("SCIM"),
  scim: () => getApp().scim,
  audit: managementAuditPort,
});

describe("Feature: SCIM tokens REST API", () => {
  const ns = `scim-tokens-${nanoid(8)}`;

  let seeded: ManagementTestOrg;
  let testApp: App;

  const authHeaders = () => ({
    Authorization: `Bearer ${seeded.adminToken}`,
    "Content-Type": "application/json",
  });

  const scimUsersWith = (token: string) =>
    scimApp.request(
      "/api/scim/v2/Users",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
      appContextBindingsFor(testApp),
    );

  const request = (path: string, init?: RequestInit) =>
    app.request(path, init, appContextBindingsFor(testApp));

  beforeAll(async () => {
    const planProvider: PlanProvider = {
      getActivePlan: vi.fn().mockResolvedValue(ENTERPRISE_TEST_PLAN),
    };
    testApp = createTestApp({
      planProvider: PlanProviderService.create(planProvider),
    });

    seeded = await seedManagementOrg({ prisma, ns });
    ({ connectionId } = await seedSsoConnection({
      prisma,
      organizationId: seeded.organization.id,
    }));
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["scimToken", { organizationId: seeded?.organization.id }],
      ["roleBinding", { organizationId: seeded?.organization.id }],
      ["apiKey", { organizationId: seeded?.organization.id }],
      ["organizationUser", { organizationId: seeded?.organization.id }],
      ["user", { id: seeded?.adminUserId }],
      ["organization", { id: seeded?.organization.id }],
    ]);
  });

  describe("given SCIM tokens managed over REST", () => {
    /** @scenario Listing SCIM tokens never returns secrets */
    it("describes tokens without ever including a value or a hash", async () => {
      const create = await request(`/api/scim-tokens/${MANAGEMENT_API_VERSION}/`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          connectionId,
          description: `List Secrets ${ns}`,
        }),
      });
      expect(create.status).toBe(201);
      const created = await create.json();

      const response = await request(`/api/scim-tokens/${MANAGEMENT_API_VERSION}/`, {
        headers: authHeaders(),
      });
      expect(response.status).toBe(200);
      const body = await response.json();

      const entry = body.tokens.find((token: { id: string }) => token.id === created.id);
      expect(entry).toMatchObject({ description: `List Secrets ${ns}` });
      expect(entry).toHaveProperty("createdAt");
      expect(entry).toHaveProperty("lastUsedAt");

      const raw = JSON.stringify(body);
      expect(raw).not.toContain(created.token);
      const hash = crypto.createHash("sha256").update(created.token).digest("hex");
      expect(raw).not.toContain(hash);
    });

    /** @scenario Creating a SCIM token returns the secret exactly once */
    it("returns the value once, and the value authenticates a SCIM request", async () => {
      const response = await request(`/api/scim-tokens/${MANAGEMENT_API_VERSION}/`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ connectionId, description: "Okta production" }),
      });

      expect(response.status).toBe(201);
      const created = await response.json();
      expect(created.token).toBeTruthy();
      expect(created.description).toBe("Okta production");

      const scimResponse = await scimUsersWith(created.token);
      expect(scimResponse.status).toBe(200);

      const list = await request(`/api/scim-tokens/${MANAGEMENT_API_VERSION}/`, {
        headers: authHeaders(),
      });
      expect(JSON.stringify(await list.json())).not.toContain(created.token);
    });

    /** @scenario Revoking a SCIM token stops it verifying */
    it("revokes the token, refuses SCIM requests with it, and 404s a second revoke", async () => {
      const created = await (
        await request(`/api/scim-tokens/${MANAGEMENT_API_VERSION}/`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ connectionId, description: `Revoke ${ns}` }),
        })
      ).json();

      expect((await scimUsersWith(created.token)).status).toBe(200);

      const revoke = await request(
        `/api/scim-tokens/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      expect(revoke.status).toBe(200);
      expect((await revoke.json()).success).toBe(true);

      expect((await scimUsersWith(created.token)).status).toBe(401);

      const again = await request(
        `/api/scim-tokens/${MANAGEMENT_API_VERSION}/${created.id}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      expect(again.status).toBe(404);
      expect((await again.json()).code).toBe("scim_token_not_found");
    });
  });
});
