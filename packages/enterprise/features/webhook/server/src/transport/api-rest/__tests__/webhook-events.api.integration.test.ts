// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `GET /api/webhooks/v1/events` and `/events/:id`, through the real Hono
 * route family — the ranged-read contract (`from`/`to` required, inverted
 * ranges refused), the canonical 404 for an id the log cannot answer, and
 * the governance families' documented absence from the log.
 *
 * Was bound on main in
 * `platform/app/src/app/api/webhooks/__tests__/webhooks-rest-api.integration.test.ts`,
 * against the full production app and a real ClickHouse-backed events
 * repository. This feature package has no ClickHouse test harness yet (see
 * `docs: needs production change` in the binding report), so this test
 * mounts the real route with a fake `WebhookEventsRepositoryPort` — the same
 * seam `WebhookEventsService` is built from in production — and asserts on
 * the REST boundary's status codes and error envelope, mirroring the
 * gateway-spend REST family's `testRestSecurity` pattern.
 */
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";

import { WebhookApp, type WebhookAppDependencies } from "../../../app/webhook.app";
import { WebhookEventsRepositoryPort, type WebhookEventsPage } from "../../../ports/webhook-events.port";
import { WebhookTenantsRepository } from "../../../repositories/webhook-tenants.repository";
import { WebhookEnvelopeService, type WebhookSpendEventRow } from "../../../services/webhook-envelope.service";
import { WebhookEventsService } from "../../../services/webhook-events.service";
import { createWebhookRestApp } from "../webhook.api";

const ORGANIZATION_ID = "org-events-1";
const PROJECT_ID = "proj-events-1";

/** The organization the process's own credential chain would have installed. */
const installOrganization: MiddlewareHandler = async (c, next) => {
  c.set("organization", { id: ORGANIZATION_ID });
  await next();
};

const passThrough: MiddlewareHandler = async (_c, next) => next();

/**
 * `canonicalErrorFor`'s two decisions that matter here, reproduced locally
 * rather than imported: `validation_error` answers 400 (not the class's own
 * 422), and every other `HandledError` answers as its own code and status.
 * `apps/api/src/app/api-canonical-error.ts` carries the full mapping; a
 * feature package test may not depend on the app that wires it.
 */
function canonicalError(error: unknown): { status: 400 | 404 | 500; body: unknown } {
  if (HandledError.isHandled(error)) {
    const status = error.code === "validation_error" ? 400 : ((error.httpStatus ?? 500) as 404 | 500);
    return {
      status,
      body: { error: error.code, message: error.message, meta: error.meta },
    };
  }
  return { status: 500, body: { error: "internal_error", message: String(error) } };
}

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  const { status, body } = canonicalError(error);
  return c.json(body as never, status);
};

function testSecurity(): AppRestSecurity {
  return createAppRestSecurity({
    appContext: passThrough,
    requestLogger: () => passThrough,
    requestTracer: () => passThrough,
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => {
      throw new Error("this family must not reach the project credential chain");
    },
    authorizeProjectPermission: () => {
      throw new Error("this family must not reach the project credential chain");
    },
    authorizeApiKeyCeiling: () => passThrough,
    authenticateOrganization: () => installOrganization,
    authorizeOrganizationPermission: () => passThrough,
    authorizeRouteTeamPermission: () => passThrough,
    authorizeRouteProjectPermission: () => passThrough,
    authenticateOrganizationThrowing: installOrganization,
    authorizeOrganizationPermissionThrowing: () => passThrough,
  } as never);
}

/** Every status the fake dataset can carry, mapped the way the real families are. */
function statusesFor(types: string[] | undefined): string[] {
  if (!types) return ["confirmed", "failed", "settled"];
  return [
    ...new Set(
      types.flatMap((type) => {
        if (type === "gateway.request.completed") return ["confirmed", "failed"];
        if (type === "gateway.request.settled") return ["settled"];
        return [];
      }),
    ),
  ];
}

/**
 * An in-memory stand-in for the ClickHouse-backed repository. Same contract:
 * never serves an `admitted` row (those are in-flight requests, not emitted
 * events), and an unrecognised `type` yields an empty page rather than an
 * error.
 */
class FakeWebhookEventsRepository extends WebhookEventsRepositoryPort {
  constructor(private readonly rows: WebhookSpendEventRow[]) {
    super();
  }

  async readEmittedEventsPage(input: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    types?: string[];
  }): Promise<WebhookEventsPage> {
    const statuses = statusesFor(input.types);
    const rows = this.rows
      .filter((row) => input.tenantIds.includes(row.tenantId))
      .filter((row) => statuses.includes(row.status))
      .filter((row) => input.fromMs === undefined || row.occurredAt.getTime() >= input.fromMs)
      .filter((row) => input.toMs === undefined || row.occurredAt.getTime() < input.toMs)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, input.limit);
    return { rows, nextCursor: null };
  }

  async tryReadEmittedEventById(input: {
    tenantIds: string[];
    id: string;
  }): Promise<WebhookSpendEventRow | null> {
    const separator = input.id.lastIndexOf(":");
    if (separator <= 0 || separator === input.id.length - 1) return null;
    const gatewayRequestId = input.id.slice(0, separator);
    const suffix = input.id.slice(separator + 1);
    const statuses = suffix === "completed" ? ["confirmed", "failed"] : suffix === "settled" ? ["settled"] : [];
    if (statuses.length === 0) return null;
    return (
      this.rows.find(
        (row) =>
          input.tenantIds.includes(row.tenantId) &&
          row.gatewayRequestId === gatewayRequestId &&
          statuses.includes(row.status),
      ) ?? null
    );
  }
}

class FakeWebhookTenantsRepository extends WebhookTenantsRepository {
  async tenantIdsForOrganization(_organizationId: string): Promise<string[]> {
    return [PROJECT_ID];
  }
}

function spendRow(overrides: Partial<WebhookSpendEventRow>): WebhookSpendEventRow {
  return {
    tenantId: PROJECT_ID,
    gatewayRequestId: "req-1",
    organizationId: ORGANIZATION_ID,
    teamId: "team-1",
    virtualKeyId: "vk-1",
    principalUserId: "",
    endUserId: "",
    traceId: "trace-1",
    model: "openai/gpt-5",
    providerKey: "prov-1",
    requestType: "chat",
    tokensInput: 10,
    tokensOutput: 5,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensReasoning: 0,
    costNanoUsd: 1_000_000,
    costUsd: "0.001000000",
    rateVersion: "catalog@1",
    status: "confirmed",
    errorClass: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    labels: [],
    metadata: "",
    durationMs: 500,
    occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    ...overrides,
  };
}

function buildApp(rows: WebhookSpendEventRow[]) {
  const events = WebhookEventsService.create({
    tenants: new FakeWebhookTenantsRepository(),
    events: new FakeWebhookEventsRepository(rows),
    envelopes: WebhookEnvelopeService.create(),
  });
  const unreachable = (name: string) => () => {
    throw new Error(`${name} is not under test here`);
  };
  const dependencies: WebhookAppDependencies = {
    endpoints: unreachable("endpoints") as never,
    health: { health: unreachable("health") as never },
    events,
    assertEndpointsEntitled: async () => undefined,
    dispatch: unreachable("dispatch") as never,
    runIdempotent: unreachable("runIdempotent") as never,
  };
  return createWebhookRestApp({
    security: testSecurity(),
    webhooks: () => WebhookApp.create(dependencies),
    canonicalError,
  }).hono;
}

const eventsWindow = () => {
  const now = Date.parse("2026-07-20T18:00:00.000Z");
  return `from=${now - 24 * 60 * 60 * 1000}&to=${now}`;
};

describe("the events log serves what it says it serves", () => {
  /** @scenario An event id the log cannot answer for is a canonical 404 */
  it("answers a canonical 404 for an event id this organization's log does not hold", async () => {
    const app = buildApp([]);
    const res = await app.request("/api/webhooks/v1/events/req_nothing_here:completed");

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("webhook_event_not_found");
  });

  /** @scenario A malformed event id is refused the same way as a missing one */
  it("404s an id naming no event the log ever minted, including an admitted row", async () => {
    const app = buildApp([spendRow({ gatewayRequestId: "req-x", status: "confirmed" })]);

    for (const id of ["no-suffix", "req-x:admitted", "req-x:invented", "req-y:completed"]) {
      const res = await app.request(`/api/webhooks/v1/events/${encodeURIComponent(id)}`);
      expect(res.status).toBe(404);
    }
  });

  /** @scenario The governance families are absent from the log, not merely empty by chance */
  it("serves an empty page for the governance families it does not retain", async () => {
    const app = buildApp([spendRow({})]);

    for (const type of [
      "gateway.budget.threshold_crossed",
      "gateway.budget.breached",
      "gateway.virtual_key.created",
    ]) {
      const res = await app.request(`/api/webhooks/v1/events?type=${type}&${eventsWindow()}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; next_cursor: string | null };
      expect(body.data).toEqual([]);
      expect(body.next_cursor).toBeNull();
    }
  });

  /** @scenario The events log refuses a read with no created range */
  it("refuses a listing that names no window, naming the missing bound", async () => {
    const app = buildApp([]);
    const now = Date.parse("2026-07-20T18:00:00.000Z");
    const cases = [
      { query: "", missing: "from" },
      { query: `?from=${now - 60_000}`, missing: "to" },
      { query: `?to=${now}`, missing: "from" },
    ] as const;

    for (const { query, missing } of cases) {
      const res = await app.request(`/api/webhooks/v1/events${query}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; meta?: { target?: string; fields?: string[] } };
      expect(body.error).toBe("validation_error");
      expect(body.meta?.target).toBe("query");
      expect(body.meta?.fields).toEqual(expect.arrayContaining([missing]));
    }
  });

  /** @scenario The events log refuses an inverted created range */
  it("refuses a window that ends before it starts", async () => {
    const app = buildApp([]);
    const now = Date.parse("2026-07-20T18:00:00.000Z");
    const res = await app.request(`/api/webhooks/v1/events?from=${now}&to=${now - 60_000}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; meta?: { target?: string } };
    expect(body.error).toBe("validation_error");
    expect(body.meta?.target).toBe("query");
  });
});
