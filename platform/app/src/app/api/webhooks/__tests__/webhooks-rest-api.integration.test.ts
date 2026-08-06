import { createServer, type Server } from "node:http";
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
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from "~/server/webhooks/signature";
import { expectCanonicalError } from "~/test-utils/expectCanonicalError";
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
    await expectCanonicalError(res, {
      status: 401,
      type: "unauthenticated",
      code: "missing_credentials",
    });
  });

  describe("canonical error envelope", () => {
    /** @scenario An unauthenticated request answers the canonical error envelope */
    it("answers an unauthenticated request with it", async () => {
      const res = await app.request("/api/webhooks/v1/event-types");
      await expectCanonicalError(res, {
        status: 401,
        type: "unauthenticated",
        code: "missing_credentials",
      });
    });

    /** @scenario A request-validation failure answers the canonical error envelope at 400 */
    it("answers a request-validation failure with it, at 400 and with the offending fields under meta", async () => {
      planHasWebhookEndpoints = true;
      const res = await app.request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ enabled_events: ["gateway.request.completed"] }),
      });
      const error = await expectCanonicalError(res, {
        status: 400,
        type: "bad_request",
        code: "validation_error",
      });
      expect(error.meta?.target).toBe("json");
      expect(error.meta?.fields).toEqual(expect.arrayContaining(["url"]));
      const reasons = error.meta?.reasons as Array<{
        code: string;
        meta?: { field?: string };
      }>;
      expect(reasons.map((r) => r.meta?.field)).toEqual(
        expect.arrayContaining(["url"]),
      );
    });

    /** @scenario An unexpected server failure answers the canonical error envelope naming nothing internal */
    it("answers an unexpected server failure with it, naming nothing internal", async () => {
      planHasWebhookEndpoints = true;
      const { WebhookEndpointService } = await import(
        "@ee/webhooks/webhookEndpoint.service"
      );
      const boom = vi
        .spyOn(WebhookEndpointService.prototype, "getAll")
        .mockRejectedValueOnce(
          new Error('relation "WebhookEndpoint" does not exist'),
        );
      try {
        const res = await app.request("/api/webhooks/v1/endpoints", {
          headers: headers(),
        });
        const error = await expectCanonicalError(res, {
          status: 500,
          type: "internal_error",
          code: "internal_error",
        });
        expect(error.message).not.toContain("WebhookEndpoint");
      } finally {
        boom.mockRestore();
      }
    });
  });

  /** @scenario An idempotency key on this family is unique within the organization */
  it("replays an endpoint create, secret and all, scoped to the organization", async () => {
    planHasWebhookEndpoints = true;
    const key = `idem-webhook-${ns}`;
    const body = {
      url: "https://example.com/hooks/idempotent",
      enabled_events: ["gateway.request.completed"],
    };
    const send = () =>
      app.request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: { ...headers(), "Idempotency-Key": key },
        body: JSON.stringify(body),
      });

    const first = await send();
    expect(first.status).toBe(201);
    expect(first.headers.get("X-Idempotent-Replay")).toBeNull();
    const firstBody = await first.text();

    const second = await send();
    expect(second.status).toBe(201);
    expect(second.headers.get("X-Idempotent-Replay")).toBe("true");
    // Including the signing secret, which the endpoint hands out exactly once.
    // Withholding it on the replay would return an endpoint nobody can verify.
    expect(await second.text()).toBe(firstBody);

    // The receipt hangs off the organization, not a project: this family
    // authenticates at the org, so that is the tenancy its keys are unique in.
    const receipt = await prisma.idempotencyReceipt.findUnique({
      where: { scopeId_key: { scopeId: organization.id, key } },
    });
    expect(receipt?.responseStatus).toBe(201);

    expect(
      await prisma.webhookEndpoint.findMany({
        where: { organizationId: organization.id, url: body.url },
      }),
    ).toHaveLength(1);

    const mutated = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: { ...headers(), "Idempotency-Key": key },
      body: JSON.stringify({ ...body, url: "https://example.com/hooks/other" }),
    });
    const error = await expectCanonicalError(mutated, {
      status: 409,
      code: "idempotency_error",
    });
    expect(error.meta?.reason).toBe("body_mismatch");
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
    const error = await expectCanonicalError(res, {
      status: 400,
      type: "bad_request",
    });
    expect(JSON.stringify(error)).toContain("between 1 and 100");
  });

  describe("the URL admission policy is the one the sender enforces", () => {
    // The endpoints platform used to ask only for https, so a URL the
    // automations trigger drawer refused saved fine as an endpoint. Both now
    // run the shared policy, which is the union of the two.

    // These cases are about the policy with the escape hatch OFF, so they
    // pin it off rather than inherit whatever the developer's own .env
    // happens to say. A local install running the hatch used to turn this
    // whole block green by admitting everything.
    const hatchBeforeBlock = process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
    beforeAll(() => {
      delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
    });
    afterAll(() => {
      if (hatchBeforeBlock === undefined) {
        delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
      } else {
        process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = hatchBeforeBlock;
      }
    });

    it("rejects a non-default port, which used to save and then probe it", async () => {
      planHasWebhookEndpoints = true;
      const res = await app.request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          url: "https://example.com:6379/hooks",
          enabled_events: ["gateway.request.completed"],
        }),
      });
      const error = await expectCanonicalError(res, {
        status: 400,
        type: "bad_request",
      });
      expect(JSON.stringify(error)).toContain("443");
    });

    it("rejects credentials in the URL", async () => {
      planHasWebhookEndpoints = true;
      const res = await app.request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          url: "https://user:pass@example.com/hooks",
          enabled_events: ["gateway.request.completed"],
        }),
      });
      const error = await expectCanonicalError(res, {
        status: 400,
        type: "bad_request",
      });
      expect(JSON.stringify(error)).toContain("credentials");
    });

    it("still rejects plain http when the escape hatch is off", async () => {
      planHasWebhookEndpoints = true;
      const res = await app.request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          url: "http://example.com/hooks",
          enabled_events: ["gateway.request.completed"],
        }),
      });
      const error = await expectCanonicalError(res, {
        status: 400,
        type: "bad_request",
      });
      expect(JSON.stringify(error)).toContain("https");
    });
  });

  describe("the test button reaches what real delivery reaches", () => {
    // Real delivery passed allowInsecureLocal and the test send did not, so on
    // an install running the escape hatch a local endpoint delivered fine while
    // its own test button reported the address blocked. This fires the REAL
    // route at a REAL loopback receiver with the hatch on.
    let receiver: Server;
    let receiverUrl: string;
    let hits: string[] = [];
    let captured: Array<{ headers: Record<string, string>; body: string }> = [];
    const originalHatch = process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;

    beforeAll(async () => {
      receiver = createServer((req, res) => {
        hits.push(req.url ?? "");
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          captured.push({
            headers: req.headers as Record<string, string>,
            body: Buffer.concat(chunks).toString("utf8"),
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        });
      });
      await new Promise<void>((resolve) =>
        receiver.listen(0, "127.0.0.1", resolve),
      );
      const address = receiver.address();
      if (typeof address === "string" || address === null) {
        throw new Error("expected an AddressInfo");
      }
      receiverUrl = `http://127.0.0.1:${address.port}/hook`;
    });

    afterAll(async () => {
      if (originalHatch === undefined) {
        delete process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS;
      } else {
        process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = originalHatch;
      }
      await new Promise<void>((resolve, reject) =>
        receiver.close((err) => (err ? reject(err) : resolve())),
      );
    });

    it("delivers a test fire to a loopback endpoint when the operator opted in", async () => {
      planHasWebhookEndpoints = true;
      process.env.WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS = "1";
      hits = [];
      captured = [];

      const createRes = await app.request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          url: receiverUrl,
          enabled_events: ["gateway.request.completed"],
        }),
      });
      expect(createRes.status).toBe(201);
      const { data } = (await createRes.json()) as {
        data: { id: string; secret: string };
      };

      const testRes = await app.request(
        `/api/webhooks/v1/endpoints/${data.id}/test`,
        { method: "POST", headers: headers() },
      );
      expect(testRes.status).toBe(200);
      const testBody = (await testRes.json()) as {
        data: { delivered: boolean; response_status: number | null };
      };
      expect(testBody.data.delivered).toBe(true);
      expect(testBody.data.response_status).toBe(200);
      expect(hits).toEqual(["/hook"]);

      // The route ran through the REAL shared sender, so this is also the
      // only place the signature is checked against bytes that actually
      // crossed a socket rather than a mock's arguments.
      const received = captured[0]!;
      const signature = received.headers[
        WEBHOOK_SIGNATURE_HEADER.toLowerCase()
      ] as string;
      expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(
        verifyWebhookSignature({
          secret: data.secret,
          body: received.body,
          header: signature,
          nowSeconds: Math.floor(Date.now() / 1000),
        }),
      ).toBe(true);
      expect(received.headers["x-langwatch-delivery-id"]).toMatch(/^test:/);
      expect(received.headers["x-langwatch-test-fire"]).toBe("true");
    });
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
        body: JSON.stringify({ status: "disabled" }),
      },
    );
    const disabled = (await disableRes.json()) as {
      data: { status: string; disabled_reason: string };
    };
    expect(disabled.data.status).toBe("disabled");
    expect(disabled.data.disabled_reason).toBe("manual");

    const enableRes = await app.request(
      `/api/webhooks/v1/endpoints/${data.id}`,
      {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status: "active" }),
      },
    );
    const enabled = (await enableRes.json()) as { data: { status: string } };
    expect(enabled.data.status).toBe("active");
  });

  it("refuses the stored SCREAMING_SNAKE spelling of status", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await app.request("/api/webhooks/v1/endpoints", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        url: "https://example.com/hooks/casing",
        enabled_events: ["gateway.*"],
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const res = await app.request(`/api/webhooks/v1/endpoints/${data.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ status: "DISABLED" }),
    });
    expect(res.status).toBe(400);
  });

  /** @scenario Without the plan flag the surface refuses politely */
  it("returns 403 with an enterprise message when the plan lacks the flag", async () => {
    planHasWebhookEndpoints = false;
    try {
      const res = await app.request("/api/webhooks/v1/endpoints", {
        headers: headers(),
      });
      const error = await expectCanonicalError(res, {
        status: 403,
        type: "permission_denied",
      });
      expect(error.message).toContain("enterprise");
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
    expect(body.data.status).toBe("active");
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

  describe("the events log serves what it says it serves", () => {
    /** @scenario An event id the log cannot answer for is a canonical 404 */
    it("404s for an event id that is not in this organization's log", async () => {
      planHasWebhookEndpoints = true;
      const res = await app.request(
        "/api/webhooks/v1/events/req_nothing_here:completed",
        { headers: headers() },
      );
      expect(res.status).toBe(404);
      await expectCanonicalError(res, {
        status: 404,
        code: "webhook_event_not_found",
      });
    });

    /** @scenario A malformed event id is refused the same way as a missing one */
    it("404s for an id that names no event this log ever minted", async () => {
      planHasWebhookEndpoints = true;
      // `admitted` rows are in-flight requests, never emitted events, so an
      // id naming one addresses nothing the log served.
      for (const id of ["no-suffix", "req_x:admitted", "req_x:invented"]) {
        const res = await app.request(
          `/api/webhooks/v1/events/${encodeURIComponent(id)}`,
          { headers: headers() },
        );
        expect(res.status).toBe(404);
      }
    });

    /** @scenario The governance families are absent from the log, not merely empty by chance */
    it("serves an empty page for the governance families it does not retain", async () => {
      planHasWebhookEndpoints = true;
      // These types ARE delivered by webhook. They are not in this log, and
      // the route documents that rather than implying a transient gap.
      for (const type of [
        "gateway.budget.threshold_crossed",
        "gateway.budget.breached",
        "gateway.virtual_key.created",
      ]) {
        const res = await app.request(`/api/webhooks/v1/events?type=${type}`, {
          headers: headers(),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          data: unknown[];
          next_cursor: string | null;
        };
        expect(body.data).toEqual([]);
        expect(body.next_cursor).toBeNull();
      }
    });
  });
});
