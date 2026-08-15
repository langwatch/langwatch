import { createServer, type Server } from "node:http";
import { WebhookEventsClickHouseRepository } from "@ee/webhooks/webhookEvents.clickhouse.repository";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
} from "~/server/webhooks/signature";
import { expectCanonicalError } from "~/test-utils/expectCanonicalError";
import { KSUID_RESOURCES } from "~/utils/constants";

// The enterprise gate reads the org's active plan through the app layer;
// tests flip this flag per scenario instead of booting the whole app. The
// route takes its events-log repository from `getApp().gateway` too, at
// whatever ClickHouse this environment's own `~/server/clickhouse/clickhouseClient`
// resolves (unmocked here, same as before this repository moved off the
// route's own inline resolver).
let planHasWebhookEndpoints = true;
vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    planProvider: {
      getActivePlan: async () => ({
        webhookEndpointsEnabled: planHasWebhookEndpoints,
      }),
    },
    gateway: {
      webhookEvents: new WebhookEventsClickHouseRepository(async (tenantId) => {
        const client = await getClickHouseClientForProject(tenantId);
        if (!client) throw new Error("ClickHouse is not configured");
        return client;
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

  /** The created range the events log requires, as query-string params. */
  const eventsWindow = () => {
    // One clock read: two would let a backward step invert the range and turn
    // an assertion about the page into a 422 about the window.
    const now = Date.now();
    return `from=${now - 24 * 60 * 60 * 1000}&to=${now}`;
  };

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
        const res = await app.request(
          `/api/webhooks/v1/events?type=${type}&${eventsWindow()}`,
          { headers: headers() },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          data: unknown[];
          next_cursor: string | null;
        };
        expect(body.data).toEqual([]);
        expect(body.next_cursor).toBeNull();
      }
    });

    /** @scenario The events log refuses a read with no created range */
    it("refuses a listing that names no window, naming the missing bound", async () => {
      planHasWebhookEndpoints = true;
      // Unbounded, the walk sorts the whole 13-month spend table under FINAL
      // on every page, so the range is part of the contract rather than a
      // filter. Half a range is refused for the same reason as none.
      const now = Date.now();
      const cases = [
        { query: "", missing: "from" },
        { query: `?from=${now - 60_000}`, missing: "to" },
        { query: `?to=${now}`, missing: "from" },
      ] as const;
      for (const { query, missing } of cases) {
        const res = await app.request(`/api/webhooks/v1/events${query}`, {
          headers: headers(),
        });
        const error = await expectCanonicalError(res, {
          status: 400,
          type: "bad_request",
          code: "validation_error",
        });
        expect(error.meta?.target).toBe("query");
        expect(error.meta?.fields).toEqual(expect.arrayContaining([missing]));
      }
    });

    /** @scenario The events log refuses an inverted created range */
    it("refuses a window that ends before it starts", async () => {
      planHasWebhookEndpoints = true;
      const now = Date.now();
      const res = await app.request(
        `/api/webhooks/v1/events?from=${now}&to=${now - 60_000}`,
        { headers: headers() },
      );
      const error = await expectCanonicalError(res, {
        status: 400,
        type: "bad_request",
        code: "validation_error",
      });
      // Without this the case passes for a validation error about anything at
      // all, including a body the route does not take.
      expect(error.meta?.target).toBe("query");
    });
  });

  describe("when an endpoint names a destination kind", () => {
    const QUEUE_URL =
      "https://sqs.eu-central-1.amazonaws.com/381491922238/lw-test-billing";

    // Restored in a hook, not at the end of a body: an assertion that throws
    // first would otherwise leave the flag set for every test that follows,
    // and integration tests here run serially in one worker. The next run of
    // the refusal case would then pass only by file order, which is a false
    // pass on the control that keeps one tenant off another tenant's queue.
    afterEach(() => {
      delete process.env.WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS;
    });

    const createEndpoint = (body: Record<string, unknown>) =>
      app.request("/api/webhooks/v1/endpoints", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });

    /** @scenario A FIFO queue is refused at save time */
    it("refuses a FIFO queue and says standard queues only", async () => {
      planHasWebhookEndpoints = true;
      process.env.WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS = "1";
      const res = await createEndpoint({
        destination_kind: "sqs",
        sqs: {
          queue_url:
            "https://sqs.eu-central-1.amazonaws.com/381491922238/orders.fifo",
        },
        enabled_events: ["gateway.request.completed"],
      });
      const error = await expectCanonicalError(res, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
      expect(error.message).toMatch(/standard queue/i);
    });

    /** @scenario A queue URL outside the canonical Amazon SQS shape is refused */
    it("refuses a queue URL that is not an Amazon SQS queue URL", async () => {
      planHasWebhookEndpoints = true;
      process.env.WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS = "1";
      const res = await createEndpoint({
        destination_kind: "sqs",
        sqs: { queue_url: "https://queues.example.com/mine" },
        enabled_events: ["gateway.request.completed"],
      });
      await expectCanonicalError(res, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
    });

    /** @scenario Ambient AWS credentials need the operator opt-in */
    it("refuses a queue endpoint with no credentials of its own unless the operator opted in", async () => {
      planHasWebhookEndpoints = true;
      delete process.env.WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS;
      const refused = await createEndpoint({
        destination_kind: "sqs",
        sqs: { queue_url: QUEUE_URL },
        enabled_events: ["gateway.request.completed"],
      });
      const error = await expectCanonicalError(refused, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
      // The refusal has to say what to supply, not merely that something is
      // missing: this is the control that keeps one tenant off another's queue.
      expect(error.message).toMatch(/role_arn|access_key_id/);

      process.env.WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS = "1";
      const accepted = await createEndpoint({
        destination_kind: "sqs",
        sqs: { queue_url: QUEUE_URL },
        enabled_events: ["gateway.request.completed"],
      });
      expect(accepted.status).toBe(201);
      const body = (await accepted.json()) as {
        data: {
          sqs: { credential_mode: string; region: string; account_id: string };
        };
      };
      expect(body.data.sqs.credential_mode).toBe("ambient");
      expect(body.data.sqs.region).toBe("eu-central-1");
      expect(body.data.sqs.account_id).toBe("381491922238");
    });

    /** @scenario A queue's secret access key is never readable once saved */
    it("encrypts a static secret at rest and never returns it", async () => {
      planHasWebhookEndpoints = true;
      const res = await createEndpoint({
        destination_kind: "sqs",
        sqs: {
          queue_url: QUEUE_URL,
          access_key_id: "AKIAEXAMPLEKEYID",
          secret_access_key: "an-example-secret-access-key",
        },
        enabled_events: ["gateway.request.completed"],
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { data: { id: string } };

      // Not in the create response, and not in any read of it either.
      const serialized = JSON.stringify(created);
      expect(serialized).not.toContain("an-example-secret-access-key");
      const read = await app.request(
        `/api/webhooks/v1/endpoints/${created.data.id}`,
        { headers: headers() },
      );
      expect(await read.text()).not.toContain("an-example-secret-access-key");

      const row = await prisma.webhookEndpoint.findFirst({
        where: { id: created.data.id },
        select: { sqsSecretAccessKeyEncrypted: true, sqsAccessKeyId: true },
      });
      expect(row?.sqsAccessKeyId).toBe("AKIAEXAMPLEKEYID");
      expect(row?.sqsSecretAccessKeyEncrypted).not.toBeNull();
      expect(row?.sqsSecretAccessKeyEncrypted).not.toContain(
        "an-example-secret-access-key",
      );
    });

    /** @scenario A queue's secret access key is never readable once saved */
    it("drops the old mode's credentials when the credential mode changes", async () => {
      planHasWebhookEndpoints = true;
      const res = await createEndpoint({
        destination_kind: "sqs",
        sqs: {
          queue_url: QUEUE_URL,
          access_key_id: "AKIAROTATEME",
          secret_access_key: "the-key-being-rotated-away",
        },
        enabled_events: ["gateway.request.completed"],
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { data: { id: string } };

      // Move it onto a role. The key pair is now unreachable through every
      // read surface, so leaving it encrypted at rest would be a credential
      // nobody can see and nobody can rotate.
      const moved = await app.request(
        `/api/webhooks/v1/endpoints/${created.data.id}`,
        {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({
            sqs: {
              role_arn: "arn:aws:iam::381491922238:role/langwatch-producer",
            },
          }),
        },
      );
      expect(moved.status).toBe(200);
      const view = (await moved.json()) as {
        data: {
          sqs: { credential_mode: string; access_key_id: string | null };
        };
      };
      expect(view.data.sqs.credential_mode).toBe("assume_role");
      expect(view.data.sqs.access_key_id).toBeNull();

      const row = await prisma.webhookEndpoint.findFirst({
        where: { id: created.data.id },
        select: {
          sqsAccessKeyId: true,
          sqsSecretAccessKeyEncrypted: true,
          sqsRoleArn: true,
        },
      });
      expect(row?.sqsRoleArn).toContain("langwatch-producer");
      expect(row?.sqsAccessKeyId).toBeNull();
      expect(row?.sqsSecretAccessKeyEncrypted).toBeNull();
    });

    /** @scenario Switching credential mode drops the mode it left */
    it("drops the role when the update moves the endpoint onto a key pair", async () => {
      planHasWebhookEndpoints = true;
      const res = await createEndpoint({
        destination_kind: "sqs",
        sqs: {
          queue_url: QUEUE_URL,
          role_arn: "arn:aws:iam::381491922238:role/langwatch-producer",
        },
        enabled_events: ["gateway.request.completed"],
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { data: { id: string } };

      const moved = await app.request(
        `/api/webhooks/v1/endpoints/${created.data.id}`,
        {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({
            sqs: {
              access_key_id: "AKIATAKEOVER",
              secret_access_key: "the-key-that-must-win",
            },
          }),
        },
      );
      expect(moved.status).toBe(200);
      const view = (await moved.json()) as {
        data: {
          sqs: {
            credential_mode: string;
            role_arn: string | null;
            external_id: string | null;
            access_key_id: string | null;
          };
        };
      };
      // The role used to outrank the key pair being set, so the switch
      // answered 200 and the endpoint went on assuming the role.
      expect(view.data.sqs.credential_mode).toBe("static");
      expect(view.data.sqs.role_arn).toBeNull();
      expect(view.data.sqs.external_id).toBeNull();
      expect(view.data.sqs.access_key_id).toBe("AKIATAKEOVER");

      const row = await prisma.webhookEndpoint.findFirst({
        where: { id: created.data.id },
        select: {
          sqsRoleArn: true,
          sqsExternalId: true,
          sqsAccessKeyId: true,
          sqsSecretAccessKeyEncrypted: true,
        },
      });
      expect(row?.sqsRoleArn).toBeNull();
      expect(row?.sqsExternalId).toBeNull();
      expect(row?.sqsAccessKeyId).toBe("AKIATAKEOVER");
      expect(row?.sqsSecretAccessKeyEncrypted).not.toBeNull();

      const ambiguous = await app.request(
        `/api/webhooks/v1/endpoints/${created.data.id}`,
        {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({
            sqs: {
              role_arn: "arn:aws:iam::381491922238:role/langwatch-producer",
              access_key_id: "AKIABOTH",
              secret_access_key: "and-a-secret",
            },
          }),
        },
      );
      await expectCanonicalError(ambiguous, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
      // A refused switch changes nothing. Half of it landing would be worse
      // than either mode: the endpoint would hold credentials the caller never
      // asked it to keep.
      const afterRefusal = await prisma.webhookEndpoint.findFirst({
        where: { id: created.data.id },
        select: { sqsRoleArn: true, sqsAccessKeyId: true },
      });
      expect(afterRefusal).toEqual({
        sqsRoleArn: null,
        sqsAccessKeyId: "AKIATAKEOVER",
      });
    });

    /** @scenario Saving an endpoint names the field its destination kind is missing */
    it("names the missing field for the kind rather than refusing the whole body", async () => {
      planHasWebhookEndpoints = true;
      const res = await createEndpoint({
        destination_kind: "sqs",
        enabled_events: ["gateway.request.completed"],
      });
      const error = await expectCanonicalError(res, {
        status: 400,
        type: "bad_request",
        code: "validation_error",
      });
      expect(error.meta?.fields).toEqual(
        expect.arrayContaining(["sqs.queue_url"]),
      );
    });

    /** @scenario Saving an endpoint refuses the address of the other destination kind */
    it("refuses a body that names one kind and the other kind's address", async () => {
      planHasWebhookEndpoints = true;
      process.env.WEBHOOKS_UNSAFE_ALLOW_AMBIENT_CREDENTIALS = "1";

      const httpWithQueue = await createEndpoint({
        destination_kind: "http",
        url: "https://example.com/hooks/mixed",
        sqs: { queue_url: QUEUE_URL },
        enabled_events: ["gateway.request.completed"],
      });
      const httpError = await expectCanonicalError(httpWithQueue, {
        status: 400,
        type: "bad_request",
        code: "validation_error",
      });
      expect(httpError.meta?.fields).toEqual(expect.arrayContaining(["sqs"]));

      const queueWithUrl = await createEndpoint({
        destination_kind: "sqs",
        url: "https://example.com/hooks/mixed",
        sqs: { queue_url: QUEUE_URL },
        enabled_events: ["gateway.request.completed"],
      });
      const queueError = await expectCanonicalError(queueWithUrl, {
        status: 400,
        type: "bad_request",
        code: "validation_error",
      });
      expect(queueError.meta?.fields).toEqual(expect.arrayContaining(["url"]));
    });

    /** @scenario An endpoint never changes its destination kind */
    it("refuses to move an existing endpoint to another destination kind", async () => {
      planHasWebhookEndpoints = true;
      const created = await createEndpoint({
        url: "https://example.com/hooks/kind-change",
        enabled_events: ["gateway.request.completed"],
      });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { id: string } };

      const res = await app.request(`/api/webhooks/v1/endpoints/${data.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          destination_kind: "sqs",
          sqs: { queue_url: QUEUE_URL },
        }),
      });
      const error = await expectCanonicalError(res, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
      expect(error.message).toMatch(/cannot be changed/i);
    });

    /** @scenario An endpoint saved before destinations existed still delivers over HTTPS */
    it("keeps an endpoint with no destination kind on the HTTPS transport", async () => {
      planHasWebhookEndpoints = true;
      const created = await createEndpoint({
        url: "https://example.com/hooks/default-kind",
        enabled_events: ["gateway.request.completed"],
      });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as {
        data: { id: string; destination_kind: string; url: string; sqs: null };
      };
      expect(data.destination_kind).toBe("http");
      expect(data.url).toBe("https://example.com/hooks/default-kind");
      expect(data.sqs).toBeNull();

      const { WebhookEndpointService } = await import(
        "@ee/webhooks/webhookEndpoint.service"
      );
      const destination = await new WebhookEndpointService({
        prisma,
      }).getDestinationConfig({
        organizationId: organization.id,
        endpointId: data.id,
      });
      expect(destination).toEqual({
        kind: "http",
        url: "https://example.com/hooks/default-kind",
      });
    });
  });
});
