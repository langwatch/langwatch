import { createServer, type Server } from "node:http";
import { WebhookEventsClickHouseRepository } from "@ee/webhooks/webhookEvents.clickhouse.repository";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

/**
 * The error envelope `@langwatch/api` serves, which is FLAT rather than the
 * `{ error: { ... } }` the hand-rolled family answered.
 *
 * `message` is the CODE, never prose: a HandledError's message is server copy
 * that may name internals, so the framework refuses to ship it and consumers
 * read `tips` / `docsUrl` instead. Assertions here therefore pin `code`, which
 * is the contract, and never the wording.
 */
interface ApiErrorBody {
  code: string;
  message: string;
  type?: string;
  kind?: string;
  meta?: Record<string, unknown>;
  reasons?: Array<{
    code: string;
    meta?: { field?: string; message?: string };
  }>;
  tips?: string[];
}

async function expectApiError(
  res: Response,
  expected: { status: number; code: string },
): Promise<ApiErrorBody> {
  // biome-ignore-start lint/suspicious/noMisplacedAssertion: one refusal shape, asserted whole, for every case that produces it
  expect(res.status).toBe(expected.status);
  const body = (await res.json()) as ApiErrorBody;
  expect(body.code).toBe(expected.code);
  // `type` is the framework's mirror of `code` for the Go envelope's readers,
  // so it must never drift from it.
  expect(body.type).toBe(body.code);
  // biome-ignore-end lint/suspicious/noMisplacedAssertion: end of the shared refusal assertions
  return body;
}

/** A 422 the framework promoted from a zod failure on the request body. */
async function expectValidationError(res: Response): Promise<ApiErrorBody> {
  return await expectApiError(res, { status: 422, code: "validation_error" });
}

describe("Feature: Webhook endpoints management API", () => {
  const ns = `webhooks-api-${nanoid(8)}`;

  let organization: Organization;
  let apiKeyToken: string;
  let userId: string;

  const headers = () => ({
    Authorization: `Bearer ${apiKeyToken}`,
    "Content-Type": "application/json",
  });

  /**
   * One RPC call. Every operation on this family is a POST to a dotted name
   * with its arguments in the body (ADR-094), so the only things that vary
   * per call are the name, the arguments, and the occasional extra header.
   */
  const rpc = (
    operation: string,
    args?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ) =>
    app.request(`/api/webhooks/${operation}`, {
      method: "POST",
      headers: { ...headers(), ...extraHeaders },
      ...(args !== undefined ? { body: JSON.stringify(args) } : {}),
    });

  /** The created range the events log requires, as body fields. */
  const eventsWindow = () => {
    // One clock read: two would let a backward step invert the range and turn
    // an assertion about the page into a 422 about the window.
    const now = Date.now();
    return { from: now - 24 * 60 * 60 * 1000, to: now };
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
    const res = await app.request("/api/webhooks/endpoints.list", {
      method: "POST",
    });
    await expectApiError(res, { status: 401, code: "missing_credentials" });
  });

  describe("when a request is refused", () => {
    /** @scenario An unauthenticated request answers the canonical error envelope */
    it("answers an unauthenticated request with it", async () => {
      const res = await app.request("/api/webhooks/eventTypes.list", {
        method: "POST",
      });
      await expectApiError(res, { status: 401, code: "missing_credentials" });
    });

    /** @scenario An identifier that names nothing is refused as a validation error */
    it("answers a request-validation failure at 422, naming the offending field", async () => {
      planHasWebhookEndpoints = true;
      const res = await rpc("endpoints.create", {
        enabled_events: ["gateway.request.completed"],
      });
      const error = await expectValidationError(res);
      // The framework promotes a ZodError to a ValidationError, mapping each
      // issue to a `schema_failure` reason. The reasons are top-level on the
      // envelope, not nested under meta as the hand-rolled family had them.
      expect(error.reasons?.map((r) => r.code)).toContain("schema_failure");
      expect(error.reasons?.map((r) => r.meta?.field)).toEqual(
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
        const res = await rpc("endpoints.list");
        const error = await expectApiError(res, {
          status: 500,
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
      rpc("endpoints.create", body, { "Idempotency-Key": key });

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

    const mutated = await rpc(
      "endpoints.create",
      { ...body, url: "https://example.com/hooks/other" },
      { "Idempotency-Key": key },
    );
    const error = await expectApiError(mutated, {
      status: 409,
      code: "idempotency_error",
    });
    expect(error.meta?.reason).toBe("body_mismatch");
  });

  /** @scenario The signing secret is returned only at create and roll time */
  it("creates an endpoint returning the secret once; reads never carry it", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await rpc("endpoints.create", {
      url: "https://example.com/hooks/billing",
      enabled_events: ["gateway.request.completed"],
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      data: { id: string; secret: string; enabled_events: string[] };
    };
    expect(created.data.secret).toMatch(/^whsec_/);
    expect(created.data.enabled_events).toEqual(["gateway.request.completed"]);

    const listRes = await rpc("endpoints.list");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      data: Array<Record<string, unknown>>;
    };
    for (const row of listed.data) {
      expect(row).not.toHaveProperty("secret");
      expect(row).not.toHaveProperty("secretEncrypted");
      expect(row).not.toHaveProperty("secret_encrypted");
    }

    const getRes = await rpc("endpoints.get", { id: created.data.id });
    const fetched = (await getRes.json()) as { data: Record<string, unknown> };
    expect(fetched.data).not.toHaveProperty("secret");

    const rollRes = await rpc("endpoints.rollSecret", { id: created.data.id });
    expect(rollRes.status).toBe(200);
    const rolled = (await rollRes.json()) as { data: { secret: string } };
    expect(rolled.data.secret).toMatch(/^whsec_/);
    expect(rolled.data.secret).not.toBe(created.data.secret);
  });

  it("rejects out-of-bounds delivery controls with the bound in the error", async () => {
    planHasWebhookEndpoints = true;
    const res = await rpc("endpoints.create", {
      url: "https://example.com/hooks/bounds",
      enabled_events: ["gateway.request.completed"],
      max_batch_size: 1000,
    });
    const error = await expectApiError(res, {
      status: 400,
      code: "webhook_endpoint_invalid",
    });
    // One code answers four different rules, so the caller needs to know
    // WHICH it broke. That used to live in the message; the framework
    // publishes the code there now, so it travels in meta with the sentence
    // in tips.
    expect(error.meta?.reason).toBe("delivery_controls");
    expect(error.tips?.join(" ")).toContain("between 1 and 100");
  });

  describe("when a URL is submitted for admission", () => {
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
      const res = await rpc("endpoints.create", {
        url: "https://example.com:6379/hooks",
        enabled_events: ["gateway.request.completed"],
      });
      const error = await expectApiError(res, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
      expect(error.meta?.reason).toBe("port");
      expect(error.tips?.join(" ")).toContain("443");
    });

    it("rejects credentials in the URL", async () => {
      planHasWebhookEndpoints = true;
      const res = await rpc("endpoints.create", {
        url: "https://user:pass@example.com/hooks",
        enabled_events: ["gateway.request.completed"],
      });
      const error = await expectApiError(res, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
      expect(error.meta?.reason).toBe("credentials");
      expect(error.tips?.join(" ")).toContain("credentials");
    });

    it("still rejects plain http when the escape hatch is off", async () => {
      planHasWebhookEndpoints = true;
      const res = await rpc("endpoints.create", {
        url: "http://example.com/hooks",
        enabled_events: ["gateway.request.completed"],
      });
      const error = await expectApiError(res, {
        status: 400,
        code: "webhook_endpoint_invalid",
      });
      expect(error.meta?.reason).toBe("scheme");
      expect(error.tips?.join(" ")).toContain("https");
    });
  });

  describe("when the test button fires at a real receiver", () => {
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

      const createRes = await rpc("endpoints.create", {
        url: receiverUrl,
        enabled_events: ["gateway.request.completed"],
      });
      expect(createRes.status).toBe(201);
      const { data } = (await createRes.json()) as {
        data: { id: string; secret: string };
      };

      const testRes = await rpc("endpoints.test", { id: data.id });
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

  /**
   * Six rules answer `webhook_endpoint_invalid`, so the status alone says
   * almost nothing: this passed just as well when the handler returned a
   * generic refusal that had lost the reason and the tip. What the caller
   * needs is WHICH rule they broke, and that travels in `meta.reason`.
   */
  it("rejects unknown event selectors, naming the rule that refused", async () => {
    planHasWebhookEndpoints = true;
    const res = await rpc("endpoints.create", {
      url: "https://example.com/hooks",
      enabled_events: ["gateway.request.imagined"],
    });

    const body = await expectApiError(res, {
      status: 400,
      code: "webhook_endpoint_invalid",
    });
    expect(body.meta?.reason).toBe("events");
    expect(body.tips?.[0]).toContain("gateway.request.imagined");
  });

  it("flips enable and disable through endpoints.update with the manual reason", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await rpc("endpoints.create", {
      url: "https://example.com/hooks/toggle",
      enabled_events: ["gateway.*"],
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const disableRes = await rpc("endpoints.update", {
      id: data.id,
      status: "disabled",
    });
    const disabled = (await disableRes.json()) as {
      data: { status: string; disabled_reason: string };
    };
    expect(disabled.data.status).toBe("disabled");
    expect(disabled.data.disabled_reason).toBe("manual");

    const enableRes = await rpc("endpoints.update", {
      id: data.id,
      status: "active",
    });
    const enabled = (await enableRes.json()) as { data: { status: string } };
    expect(enabled.data.status).toBe("active");
  });

  it("refuses the stored SCREAMING_SNAKE spelling of status", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await rpc("endpoints.create", {
      url: "https://example.com/hooks/casing",
      enabled_events: ["gateway.*"],
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const res = await rpc("endpoints.update", {
      id: data.id,
      status: "DISABLED",
    });
    await expectValidationError(res);
  });

  /** @scenario Without the plan flag the surface refuses politely */
  it("returns 402 enterprise_plan_required when the plan lacks the flag", async () => {
    planHasWebhookEndpoints = false;
    try {
      const res = await rpc("endpoints.list");
      const error = await expectApiError(res, {
        status: 402,
        code: "enterprise_plan_required",
      });
      // Not the message: the framework publishes the CODE there. The words a
      // customer reads are the remediation channel, and `meta.feature` is what
      // a client branches on.
      expect(error.meta?.feature).toBe("WEBHOOKS");
    } finally {
      planHasWebhookEndpoints = true;
    }
  });

  it("archives an endpoint and hides it from reads", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await rpc("endpoints.create", {
      url: "https://example.com/hooks/archive-me",
      enabled_events: ["gateway.request.completed"],
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const deleteRes = await rpc("endpoints.archive", { id: data.id });
    expect(deleteRes.status).toBe(200);

    const getRes = await rpc("endpoints.get", { id: data.id });
    expect(getRes.status).toBe(404);
  });

  it("serves the health report for an endpoint", async () => {
    planHasWebhookEndpoints = true;
    const createRes = await rpc("endpoints.create", {
      url: "https://example.com/hooks/health-probe",
      enabled_events: ["gateway.request.completed"],
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const res = await rpc("endpoints.getHealth", { id: data.id });
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

  // The zero-argument rule from ADR-094, end to end. `eventTypes.list` declares
  // no `input`, so the framework installs no json validator and a POST with no
  // body at all must succeed. Declaring `input: z.object({}).optional()` to
  // satisfy a "POSTs take a body" instinct would reinstate the parse and 4xx
  // exactly this call.
  /** @scenario An operation taking no arguments accepts a call with no body */
  it("serves an argument-free operation called with no request body", async () => {
    planHasWebhookEndpoints = true;

    const res = await app.request("/api/webhooks/eventTypes.list", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKeyToken}` },
    });

    expect(res.status).toBe(200);
    expect((await res.json()).data.length).toBeGreaterThan(0);
  });

  it("serves the event-type catalog for the subscription UI", async () => {
    planHasWebhookEndpoints = true;
    const res = await rpc("eventTypes.list");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ type: string; family: string; is_emitting: boolean }>;
    };
    const completed = body.data.find(
      (t) => t.type === "gateway.request.completed",
    );
    expect(completed).toMatchObject({ family: "gateway", is_emitting: true });
  });

  describe("when the events log is queried", () => {
    /** @scenario An event id the log cannot answer for is a canonical 404 */
    it("404s for an event id that is not in this organization's log", async () => {
      planHasWebhookEndpoints = true;
      const res = await rpc("events.get", { id: "req_nothing_here:completed" });
      expect(res.status).toBe(404);
      await expectApiError(res, {
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
        const res = await rpc("events.get", { id });
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
        const res = await rpc("events.list", { type, ...eventsWindow() });
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
        { args: {}, missing: "from" },
        { args: { from: now - 60_000 }, missing: "to" },
        { args: { to: now }, missing: "from" },
      ] as const;
      for (const { args, missing } of cases) {
        const res = await rpc("events.list", args);
        const error = await expectValidationError(res);
        expect(error.reasons?.map((r) => r.meta?.field)).toEqual(
          expect.arrayContaining([missing]),
        );
      }
    });

    /** @scenario The events log refuses an inverted created range */
    it("refuses a window that ends before it starts", async () => {
      planHasWebhookEndpoints = true;
      const now = Date.now();
      const res = await rpc("events.list", { from: now, to: now - 60_000 });
      const error = await expectValidationError(res);
      // Without naming the rule, the case passes for a validation error about
      // anything at all — including a field the operation does not take.
      expect(error.reasons?.map((r) => r.meta?.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("less than or equal to"),
        ]),
      );
    });
  });
});
