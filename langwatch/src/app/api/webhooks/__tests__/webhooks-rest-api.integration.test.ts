import { generate } from "@langwatch/ksuid";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";

// The enterprise gate reads the org's active plan through the app layer;
// tests flip this flag per scenario instead of booting the whole app.
let planHasWebhookEndpoints = true;
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: {
      getActivePlan: async () => ({
        webhookEndpointsEnabled: planHasWebhookEndpoints,
      }),
    },
  }),
}));

import { app } from "../[[...route]]/app";

describe("Feature: Webhook endpoints REST API", () => {
  const ns = `webhooks-api-${nanoid(8)}`;

  let organization: Organization;
  let apiKeyToken: string;
  let userId: string;

  const headers = () => ({
    Authorization: `Bearer ${apiKeyToken}`,
    "Content-Type": "application/json",
  });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Webhooks API Org", slug: `--test-org-${ns}` },
    });
    const user = await prisma.user.create({
      data: { name: "Webhooks Test User", email: `test-${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: organization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
    });
    const apiKeyService = ApiKeyService.create(prisma);
    const created = await apiKeyService.create({
      name: `webhooks-key-${nanoid(6)}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    });
    apiKeyToken = created.token;
  });

  afterAll(async () => {
    if (!organization?.id) return;
    await prisma.webhookEndpointDelivery.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.webhookEndpoint.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.apiKey.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  it("returns 401 without an api key", async () => {
    const res = await app.request("/api/webhooks/v1/endpoints");
    expect(res.status).toBe(401);
  });

  /** @scenario The signing secret is returned only at create and roll time */
  it("creates an endpoint returning the secret once; reads never carry it", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: "https://example.com/hooks/billing",
        enabled_events: ["gateway.request.completed"],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      data: { id: string; secret: string; enabled_events: string[] };
    };
    expect(created.data.secret).toMatch(/^whsec_/);
    expect(created.data.enabled_events).toEqual(["gateway.request.completed"]);

    const listRes = await app.request("/api/webhooks/v1/endpoints", {
      headers: headers(),
    });
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      data: Array<Record<string, unknown>>;
    };
    for (const row of listed.data) {
      expect(row).not.toHaveProperty("secret");
      expect(row).not.toHaveProperty("secretEncrypted");
      expect(row).not.toHaveProperty("secret_encrypted");
    }

    const getRes = await app.request(
      `/api/webhooks/v1/endpoints/${created.data.id}`,
      { headers: headers() },
    );
    const fetched = (await getRes.json()) as { data: Record<string, unknown> };
    expect(fetched.data).not.toHaveProperty("secret");

    const rollRes = await app.request(
      `/api/webhooks/v1/endpoints/${created.data.id}/roll-secret`,
      { method: "POST", headers: headers() },
    );
    expect(rollRes.status).toBe(200);
    const rolled = (await rollRes.json()) as { data: { secret: string } };
    expect(rolled.data.secret).toMatch(/^whsec_/);
    expect(rolled.data.secret).not.toBe(created.data.secret);
  });

  it("rejects out-of-bounds delivery controls with the bound in the error", async () => {
    planHasWebhookEndpoints = true;
    const res = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: "https://example.com/hooks/bounds",
        enabled_events: ["gateway.request.completed"],
        max_batch_size: 1000,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string; error?: string };
    expect(JSON.stringify(body)).toContain("between 1 and 100");
  });

  it("rejects unknown event selectors with a 400", async () => {
    planHasWebhookEndpoints = true;
    const res = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: "https://example.com/hooks",
        enabled_events: ["gateway.request.imagined"],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH status flips enable and disable with the manual reason", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: "https://example.com/hooks/toggle",
        enabled_events: ["gateway.*"],
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const disableRes = await app.request(
      `/api/webhooks/v1/endpoints/${data.id}`,
      {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status: "DISABLED" }),
      },
    );
    const disabled = (await disableRes.json()) as {
      data: { status: string; disabled_reason: string };
    };
    expect(disabled.data.status).toBe("DISABLED");
    expect(disabled.data.disabled_reason).toBe("manual");

    const enableRes = await app.request(
      `/api/webhooks/v1/endpoints/${data.id}`,
      {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status: "ACTIVE" }),
      },
    );
    const enabled = (await enableRes.json()) as { data: { status: string } };
    expect(enabled.data.status).toBe("ACTIVE");
  });

  /** @scenario Without the plan flag the surface refuses politely */
  it("returns 403 with an enterprise message when the plan lacks the flag", async () => {
    planHasWebhookEndpoints = false;
    try {
      const res = await app.request("/api/webhooks/v1/endpoints", {
        headers: headers(),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { message?: string; error?: string };
      expect(JSON.stringify(body)).toContain("enterprise");
    } finally {
      planHasWebhookEndpoints = true;
    }
  });

  it("archives an endpoint and hides it from reads", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: "https://example.com/hooks/archive-me",
        enabled_events: ["gateway.request.completed"],
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const deleteRes = await app.request(
      `/api/webhooks/v1/endpoints/${data.id}`,
      { method: "DELETE", headers: headers() },
    );
    expect(deleteRes.status).toBe(200);

    const getRes = await app.request(`/api/webhooks/v1/endpoints/${data.id}`, {
      headers: headers(),
    });
    expect(getRes.status).toBe(404);
  });

  it("serves the health report for an endpoint", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: "https://example.com/hooks/health-probe",
        enabled_events: ["gateway.request.completed"],
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const res = await app.request(
      `/api/webhooks/v1/endpoints/${data.id}/health`,
      { headers: headers() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        status: string;
        oldest_undelivered_age_ms: number | null;
        dlq_depth: number;
        sends_per_minute: number;
      };
    };
    expect(body.data.status).toBe("ACTIVE");
    expect(body.data.oldest_undelivered_age_ms).toBeNull();
    expect(body.data.dlq_depth).toBe(0);
    expect(body.data.sends_per_minute).toBe(0);
  });

  it("serves the event-type catalog for the subscription UI", async () => {
    planHasWebhookEndpoints = true;
    const res = await app.request("/api/webhooks/v1/event-types", {
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ type: string; family: string; is_emitting: boolean }>;
    };
    const completed = body.data.find(
      (t) => t.type === "gateway.request.completed",
    );
    expect(completed).toMatchObject({ family: "gateway", is_emitting: true });
  });
});
