/**
 * @vitest-environment node
 *
 * The billing reconciliation REST surface's BOUNDARY, driven through the real
 * organization credential chain this process builds.
 *
 * What is pinned here is everything a caller meets before the ledger is read:
 * the canonical error envelope on every refusal, the enterprise plan gate,
 * the window and cursor validation, the grouping-stability guard with its
 * query-string boolean, and the replay cap. The ledger itself is a double at
 * the port, because none of those decisions depend on what ClickHouse
 * answers — and the arithmetic that does is asserted against real rows in
 * `@langwatch/gateway-server`'s own ledger suite.
 *
 * Spec: specs/ai-gateway/gateway-spend-rest.feature
 * Spec: specs/ai-gateway/public-rest-api.feature
 * Spec: specs/ai-gateway/billing-spend-events.feature
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { apiErrorSchema, requestTraceIds } from "@langwatch/api/rest";
import type { AuthzService } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  createGatewaySpendRestApp,
  encodeSpendSummariesCursor,
  GatewaySpendEventsPort,
  GatewaySpendEventsService,
  type GatewaySpendEnvelope,
  type GatewaySpendWebhookEndpoint,
} from "@langwatch/gateway-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { ApiRestSecurity } from "../../api-rest.security";
import { canonicalErrorFor } from "../api-canonical-error";
import { composeApiGatewaySpendRest } from "../api-gateway-spend-rest.composition";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";
const ORGANIZATION_TOKEN = "org-key-token";
const PROJECT_TOKEN = "project-key-token";
const BASE_TIME = Date.UTC(2026, 0, 10, 12, 0, 0);

/**
 * Asserts a response carries the canonical error envelope, and returns it.
 *
 * Parses with the shipped schema rather than poking at fields, so a route that
 * answers a nearly-right shape fails here instead of passing a hand-written
 * field check. The envelope is checked STRICTLY at the top level: a leftover
 * sibling is exactly how the pre-canonical shapes leaked.
 */
async function expectCanonicalError(
  response: Response,
  expected: { status: number; type?: string; code?: string },
): Promise<{ type: string; code: string; message: string; meta?: Record<string, unknown> }> {
  expect(response.status).toBe(expected.status);
  const parsed = apiErrorSchema.strict().safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`response is not the canonical error envelope: ${parsed.error.message}`);
  }
  const { error } = parsed.data;
  // A sentence, never the empty string: this is all a human gets.
  expect(error.message.length).toBeGreaterThan(0);
  if (expected.type !== undefined) expect(error.type).toBe(expected.type);
  if (expected.code !== undefined) expect(error.code).toBe(expected.code);
  return error as { type: string; code: string; message: string; meta?: Record<string, unknown> };
}

/** The ledger, as the routes read it. */
class TestSpendLedger extends GatewaySpendEventsPort {
  summaries: Array<{ key: string; group: Record<string, string> }> = [];
  summariesCursor: string | null = null;
  readonly readSummaries = vi.fn();

  upsertFromFold(): Promise<void> {
    return Promise.resolve();
  }
  tryReadForFold(): Promise<null> {
    return Promise.resolve(null);
  }
  readSpendEventsPage(): Promise<{ rows: never[]; nextCursor: null }> {
    return Promise.resolve({ rows: [], nextCursor: null });
  }
  walkSpendEvents(): Promise<{ rows: never[]; nextCursor: null }> {
    return Promise.resolve({ rows: [], nextCursor: null });
  }
  readSpendSummaries(input: unknown): Promise<{ rows: never[]; nextCursor: string | null }> {
    this.readSummaries(input);
    const rows = this.summaries.map((row) => ({
      ...row,
      bucketStart: null,
      eventCount: 1,
      settledCount: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      tokensReasoning: 0,
      costNanoUsd: 0,
      costUsd: "0.00",
    }));
    return Promise.resolve({
      rows: rows as never[],
      nextCursor: this.summariesCursor,
    });
  }
  readEndUserSpend(): Promise<never> {
    return Promise.reject(new Error("the end-user read is not under test here"));
  }
}

/** One emitted envelope, in the wire shape a replay re-delivers. */
function envelope(id: string): GatewaySpendEnvelope {
  return {
    id: `${id}:completed`,
    type: "gateway.request.completed",
    created: new Date(BASE_TIME).toISOString(),
    schema_version: "1",
    data: { project_id: PROJECT_ID, gateway_request_id: id },
  };
}

/** The Enterprise webhook platform, reduced to what a replay touches. */
function testWebhooks(options: { emitted: GatewaySpendEnvelope[] }) {
  const endpoint: GatewaySpendWebhookEndpoint = {
    id: "endpoint-1",
    enabledEvents: ["gateway.request.completed"],
  };
  const appended: Array<{ envelope: GatewaySpendEnvelope; replayId: string }> = [];
  return {
    endpoint,
    appended,
    port: {
      endpoints: { tryGetDeliverable: async () => endpoint },
      events: {
        getEmittedEvents: async ({ cursor }: { cursor: string | null }) =>
          cursor ? { events: [], nextCursor: null } : { events: options.emitted, nextCursor: null },
      },
      delivery: {
        appendReplayToEndpointStream: async (input: {
          envelope: GatewaySpendEnvelope;
          replayId: string;
        }) => {
          appended.push({ envelope: input.envelope, replayId: input.replayId });
        },
      },
    },
  };
}

function buildApp(options?: {
  ledger?: TestSpendLedger;
  planEnabled?: boolean;
  webhooks?: ReturnType<typeof testWebhooks>["port"];
}) {
  const ledger = options?.ledger ?? new TestSpendLedger();
  const markUsed = vi.fn();
  const apiKeys = {
    resolveOrganizationToken: async ({ token }: { token: string }) => {
      if (token === ORGANIZATION_TOKEN) {
        return {
          ok: true as const,
          resolved: {
            type: "apiKey-org" as const,
            apiKeyId: "api-key-1",
            userId: "user-1",
            organizationId: ORGANIZATION_ID,
          },
        };
      }
      if (token === PROJECT_TOKEN) {
        return { ok: false as const, reason: "wrong_credential_class" as const };
      }
      return { ok: false as const, reason: "unusable_credential" as const };
    },
    markUsed,
  } as unknown as ApiKeyService;

  const security = ApiRestSecurity.create({
    apiKeys,
    authz: { hasApiKeyPermission: async () => true } as unknown as AuthzService,
    organizations: { getSettings: async () => ({}) } as unknown as OrganizationService,
    observability: ApiRestObservabilityComposition.create(),
  });

  const prisma = {
    project: { findMany: async () => [{ id: PROJECT_ID, teamId: "team-1" }] },
    virtualKey: { findMany: async () => [] },
  } as unknown as PrismaClient;

  const spend = composeApiGatewaySpendRest({
    prisma,
    gateway: {
      spendEvents: GatewaySpendEventsService.create(ledger),
      budgetSpend: undefined,
    },
    plans: {
      getActivePlan: async () => ({ webhookEndpointsEnabled: options?.planEnabled ?? true }),
    } as unknown as PlanProvider,
    settlementGraceMs: 15 * 60_000,
    ...(options?.webhooks ? { webhooks: options.webhooks } : {}),
  });

  const app = createGatewaySpendRestApp({
    security,
    billingPlanGate: spend.billingPlanGate,
    canonicalError: (error, c) => canonicalErrorFor(error, requestTraceIds(c)),
    spend: () => spend.ports,
  });

  const request = (path: string, init?: RequestInit) =>
    app.hono.fetch(
      new Request(`http://api.test${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${ORGANIZATION_TOKEN}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      }),
    );

  const anonymous = (path: string) => app.hono.fetch(new Request(`http://api.test${path}`));

  return { app, ledger, request, anonymous, markUsed };
}

/** A window whose end is far enough back that outcomes can no longer arrive. */
const settled = () => ({ from: BASE_TIME, to: BASE_TIME + 60_000 });

/** A window reaching now, so the fold can still rewrite model and provider. */
const live = () => {
  const to = Date.now();
  return { from: to - 60_000, to };
};

function summariesPath(query: Record<string, string | number>): string {
  const search = new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );
  return `/api/gateway/v1/spend-summaries?${search.toString()}`;
}

describe("given the gateway spend reconciliation REST surface", () => {
  describe("when the caller presents no credential", () => {
    /** @scenario "Requests without an org API key are unauthorized" */
    /** @scenario "An unauthenticated request answers the canonical error envelope" */
    it("refuses both reads with the canonical envelope", async () => {
      const { anonymous } = buildApp();

      for (const path of ["/api/gateway/v1/spend-events", "/api/gateway/v1/spend-summaries"]) {
        await expectCanonicalError(await anonymous(path), {
          status: 401,
          type: "unauthenticated",
          code: "missing_credentials",
        });
      }
    });
  });

  describe("when the credential is the wrong class for this surface", () => {
    it("names both the class required and the class presented", async () => {
      const { app } = buildApp();

      const response = await app.hono.fetch(
        new Request("http://api.test/api/gateway/v1/spend-summaries", {
          headers: { Authorization: `Bearer ${PROJECT_TOKEN}` },
        }),
      );

      const error = await expectCanonicalError(response, {
        status: 401,
        type: "unauthenticated",
        code: "credential_class_mismatch",
      });
      expect(error.meta).toMatchObject({
        required: "organization_api_key",
        presented: "project_api_key",
      });
    });

    it("says only that a token matching no key was not accepted", async () => {
      const { app } = buildApp();

      const response = await app.hono.fetch(
        new Request("http://api.test/api/gateway/v1/spend-summaries", {
          headers: { Authorization: "Bearer sk-lw-nosuchkey" },
        }),
      );

      const error = await expectCanonicalError(response, {
        status: 401,
        type: "unauthenticated",
        code: "invalid_credentials",
      });
      // Naming a credential class here would send someone holding a typo to
      // swap a key that was never the problem.
      expect(error.message).not.toContain("roject");
    });
  });

  describe("when the organization's plan does not include the billing events API", () => {
    /** @scenario "Without the plan flag the surface refuses politely" */
    it("refuses without the enterprise plan flag", async () => {
      const { request } = buildApp({ planEnabled: false });

      const response = await request(summariesPath({ group_by: "end_user", ...settled() }));

      const error = await expectCanonicalError(response, {
        status: 403,
        type: "permission_denied",
      });
      expect(error.message).toContain("enterprise");
    });
  });

  describe("when the request is malformed", () => {
    /** @scenario "A request-validation failure answers the canonical error envelope at 400" */
    it("answers a request-validation failure at 400 with the offending fields under meta", async () => {
      const { request } = buildApp();

      const response = await request(summariesPath({ group_by: "nonsense", ...settled() }));

      const error = await expectCanonicalError(response, {
        status: 400,
        type: "bad_request",
        code: "validation_error",
      });
      expect(error.meta?.target).toBe("query");
      expect(error.meta?.fields).toEqual(expect.arrayContaining(["group_by"]));
      // The reason chain names each offending field, in the wire's own
      // casing, so a caller never has to parse the sentence.
      const reasons = error.meta?.reasons as Array<{ code: string; meta?: { field?: string } }>;
      expect(reasons.map((reason) => reason.meta?.field)).toEqual(
        expect.arrayContaining(["group_by"]),
      );
      expect(reasons.every((reason) => reason.code === "schema_failure")).toBe(true);
    });

    /** @scenario "An inverted window is refused on both reads" */
    it("refuses the rollups the same way the events already were", async () => {
      const { request } = buildApp();
      const inverted = "from=1768046410000&to=1768046400000";

      for (const path of [
        `/api/gateway/v1/spend-summaries?group_by=virtual_key&${inverted}`,
        `/api/gateway/v1/spend-events?${inverted}`,
      ]) {
        await expectCanonicalError(await request(path), {
          status: 400,
          code: "validation_error",
        });
      }
    });

    /** @scenario "A garbled cursor is refused, not silently reset" */
    it("rejects an undecodable events cursor with 400", async () => {
      const { request } = buildApp();

      const response = await request(
        `/api/gateway/v1/spend-events?cursor=%25garbage%25&from=${BASE_TIME}&to=${BASE_TIME + 600_000}`,
      );

      expect(response.status).toBe(400);
    });

    /** @scenario "A garbled summaries cursor is refused, not silently reset" */
    it("rejects an undecodable summaries cursor with the canonical 400", async () => {
      const { request } = buildApp();

      const response = await request(
        summariesPath({ group_by: "end_user", cursor: "%%%", ...settled() }),
      );

      await expectCanonicalError(response, { status: 400, type: "bad_request" });
    });
  });

  describe("when the store fails in a way nobody anticipated", () => {
    /** @scenario "An unexpected server failure answers the canonical error envelope naming nothing internal" */
    it("answers with the envelope, naming nothing internal", async () => {
      const ledger = new TestSpendLedger();
      ledger.readSummaries.mockImplementationOnce(() => {
        throw new Error('relation "GatewaySpendRecords" does not exist');
      });
      const { request } = buildApp({ ledger });

      const response = await request(summariesPath({ group_by: "end_user", ...settled() }));

      const error = await expectCanonicalError(response, {
        status: 500,
        type: "internal_error",
        code: "internal_error",
      });
      // The raised sentence names a table; the envelope must not.
      expect(error.message).not.toContain("GatewaySpendRecords");
    });
  });

  // Through the route, because the guard has two halves and only one of them
  // is the grouping rule. The other is reading `allow_unstable` off a query
  // string, and that half shipped inverted: `z.coerce.boolean()` is
  // JavaScript `Boolean()`, so `allow_unstable=false` served the unstable
  // read it asked not to have.
  describe("when the grouping's key can move under the walk", () => {
    /** @scenario "Grouping on a movable key is refused while the window is still settling" */
    it("refuses a model grouping over a live window, naming which grouping moved", async () => {
      const { request } = buildApp();

      const response = await request(summariesPath({ group_by: "model", ...live() }));

      const error = await expectCanonicalError(response, {
        status: 400,
        code: "gateway_spend_group_by_unstable",
      });
      // The dimension and the moment it settles, so a caller can retry
      // deliberately rather than guess how long to wait.
      expect(error.meta?.group_by).toEqual(["model"]);
      expect(Date.parse(String(error.meta?.settles_at))).toBeGreaterThan(Date.now());
    });

    /** @scenario "The same grouping is served once the window has settled" */
    it("serves the same grouping over a settled window", async () => {
      const { request } = buildApp();

      const response = await request(summariesPath({ group_by: "model", ...settled() }));

      expect(response.status).toBe(200);
    });

    /** @scenario "Grouping on a key that cannot move is never refused" */
    it("never refuses a grouping whose key is fixed at admission", async () => {
      const { request } = buildApp();

      const response = await request(summariesPath({ group_by: "end_user", ...live() }));

      expect(response.status).toBe(200);
    });

    /** @scenario "A caller who accepts the risk can ask for it anyway" */
    it("serves the movable grouping when the caller opts out", async () => {
      const { request } = buildApp();

      const response = await request(
        summariesPath({ group_by: "model", allow_unstable: "true", ...live() }),
      );

      expect(response.status).toBe(200);
    });

    /** @scenario "Declining an unstable read is not the same as accepting one" */
    it("still refuses when the caller spells the opt-out as false", async () => {
      const { request } = buildApp();

      const response = await request(
        summariesPath({ group_by: "model", allow_unstable: "false", ...live() }),
      );

      await expectCanonicalError(response, {
        status: 400,
        code: "gateway_spend_group_by_unstable",
      });
    });

    /** @scenario "The opt-out is read however the caller's HTTP library spells a boolean" */
    it("accepts the capitalised boolean a Python client sends", async () => {
      const { request } = buildApp();

      // `requests` renders a Python `True` as the string `True`, and the
      // documentation for this parameter is written for Python callers.
      for (const spelling of ["True", "TRUE", "Yes", "1"]) {
        const response = await request(
          summariesPath({ group_by: "model", allow_unstable: spelling, ...live() }),
        );

        expect(response.status, `allow_unstable=${spelling}`).toBe(200);
      }

      // And `False` still means no, which is the whole point of folding case
      // rather than accepting anything non-empty.
      const declined = await request(
        summariesPath({ group_by: "model", allow_unstable: "False", ...live() }),
      );
      await expectCanonicalError(declined, {
        status: 400,
        code: "gateway_spend_group_by_unstable",
      });
    });

    /** @scenario "A spelling the surface does not know is refused by name" */
    it("refuses a spelling it cannot read rather than guessing", async () => {
      const { request } = buildApp();

      const response = await request(
        summariesPath({ group_by: "model", allow_unstable: "maybe", ...live() }),
      );

      const error = await expectCanonicalError(response, {
        status: 400,
        code: "validation_error",
      });
      // Named, so a client can put the message on the field the caller got
      // wrong instead of on a toast that says something failed.
      expect(error.meta?.fields).toEqual(["allow_unstable"]);
    });

    /** @scenario "A cursor from another grouping is refused, not silently restarted" */
    it("refuses a cursor whose arity belongs to a different grouping", async () => {
      // Page one under a single dimension, then hand its cursor back asking
      // for two. Serving that would re-run page one under a fresh cursor with
      // nothing saying the walk reset, and the checksum would count those
      // groups twice.
      const ledger = new TestSpendLedger();
      ledger.summaries = [{ key: "user-a", group: { end_user: "user-a" } }];
      ledger.summariesCursor = encodeSpendSummariesCursor(["user-a"]);
      const { request } = buildApp({ ledger });

      const first = await request(summariesPath({ group_by: "end_user", limit: 1, ...settled() }));
      expect(first.status).toBe(200);
      const cursor = ((await first.json()) as { next_cursor: string | null }).next_cursor;
      expect(cursor).not.toBeNull();

      await expectCanonicalError(
        await request(
          summariesPath({ group_by: "end_user,virtual_key", cursor: cursor!, ...settled() }),
        ),
        { status: 400 },
      );

      // A bucket adds a dimension too, so the same cursor is equally wrong
      // against a bucketed walk over the very grouping that minted it.
      await expectCanonicalError(
        await request(
          summariesPath({ group_by: "end_user", bucket: "day", cursor: cursor!, ...settled() }),
        ),
        { status: 400 },
      );

      // The control: the cursor still works for the walk it belongs to.
      const resumed = await request(
        summariesPath({ group_by: "end_user", limit: 1, cursor: cursor!, ...settled() }),
      );
      expect(resumed.status).toBe(200);
    });

    it("refuses a fixed offset in place of a named zone, naming the field", async () => {
      // The runtime builds a formatter for `+05:00` happily; ClickHouse loads
      // zones by name only. Left to reach the store, a value the caller chose
      // comes back as an unknown error from somewhere they cannot see.
      const { request } = buildApp();

      const error = await expectCanonicalError(
        await request(
          summariesPath({
            group_by: "end_user",
            bucket: "day",
            timezone: "+05:00",
            ...settled(),
          }),
        ),
        { status: 400, code: "validation_error" },
      );
      expect(error.meta?.fields).toEqual(["timezone"]);

      const named = await request(
        summariesPath({
          group_by: "end_user",
          bucket: "day",
          timezone: "Europe/Amsterdam",
          ...settled(),
        }),
      );
      expect(named.status).toBe(200);
    });
  });

  describe("when a window is replayed onto one endpoint", () => {
    /** @scenario "Replay re-delivers a window's envelopes to one endpoint through the delivery path" */
    it("replays a window to one endpoint with unchanged envelope ids", async () => {
      const webhooks = testWebhooks({ emitted: [envelope("req-a"), envelope("req-b")] });
      const { request } = buildApp({ webhooks: webhooks.port });

      const response = await request("/api/gateway/v1/spend-events/replay", {
        method: "POST",
        body: JSON.stringify({
          from: BASE_TIME,
          to: BASE_TIME + 10_000,
          endpoint_id: webhooks.endpoint.id,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { replayed: number; replay_id: string } };
      expect(body.data.replayed).toBe(2);
      // The replayed envelopes ride the delivery path, and the ids inside
      // are the original type-suffixed ids, unchanged.
      expect(webhooks.appended.map((sent) => sent.envelope.id).sort()).toEqual([
        "req-a:completed",
        "req-b:completed",
      ]);
      // One replay identity per call, so redelivered envelopes cannot
      // collide with their historical batches.
      expect(new Set(webhooks.appended.map((sent) => sent.replayId)).size).toBe(1);
    });

    it("refuses an inverted window", async () => {
      const webhooks = testWebhooks({ emitted: [] });
      const { request } = buildApp({ webhooks: webhooks.port });

      const response = await request("/api/gateway/v1/spend-events/replay", {
        method: "POST",
        body: JSON.stringify({
          from: BASE_TIME + 10_000,
          to: BASE_TIME,
          endpoint_id: webhooks.endpoint.id,
        }),
      });

      expect(response.status).toBe(400);
    });

    /** @scenario "An over-limit replay queues nothing" */
    it("refuses an over-limit window before queuing a single envelope", async () => {
      // A window one envelope past the cap, served synthetically: the case is
      // about the cap, and seeding ten thousand ledger rows to reach it would
      // cost minutes for no extra coverage.
      const webhooks = testWebhooks({
        emitted: Array.from({ length: 10_001 }, (_, index) => envelope(`flood-${index}`)),
      });
      const { request } = buildApp({ webhooks: webhooks.port });

      const response = await request("/api/gateway/v1/spend-events/replay", {
        method: "POST",
        body: JSON.stringify({
          from: BASE_TIME,
          to: BASE_TIME + 10_000,
          endpoint_id: webhooks.endpoint.id,
        }),
      });

      expect(response.status).toBe(400);
      // Refused means nothing shipped. A partial enqueue here would
      // double-deliver on the caller's retry.
      expect(webhooks.appended).toEqual([]);
    });
  });
});
