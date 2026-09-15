// SPDX-License-Identifier: Apache-2.0

/**
 * `/api/webhooks/v1`, through the real `webhookRest` declaration mounted on a
 * package-local runtime. Covers the entitlement gate, the CRUD wire shape and
 * the events log's ranged-read contract.
 * @see specs/webhooks/webhook-endpoints.feature
 * @see modules/webhook/specs/webhooks.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { WebhookEndpointsNotEntitledError } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type { WebhookAppDependencies } from "../../app/webhook.app.ts";
import {
  WebhookEventsRepository,
  type WebhookEventsPage,
} from "../../repositories/webhook-events.repository.ts";
import { WebhookTenantsRepository } from "../../repositories/webhook-tenants.repository.ts";
import {
  WebhookEnvelopeService,
  type WebhookSpendEventRow,
} from "../../services/webhook-envelope.service.ts";
import { WebhookEventsService } from "../../services/webhook-events.service.ts";
import { mountWebhookRest, ORGANIZATION_ID } from "./webhook-rest.harness.ts";

const PROJECT_ID = "proj-events-1";

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

/** The statuses one `gatewayRequestId:suffix` id can resolve to, by its suffix. */
function statusesForSuffix(suffix: string): string[] {
  if (suffix === "completed") return ["confirmed", "failed"];
  if (suffix === "settled") return ["settled"];
  return [];
}

/**
 * An in-memory stand-in for the ClickHouse-backed repository. Same contract:
 * never serves an `admitted` row (those are in-flight requests, not emitted
 * events), and an unrecognised `type` yields an empty page rather than an
 * error.
 */
class FakeWebhookEventsRepository extends WebhookEventsRepository {
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
      .filter(
        (row) => input.fromMs === undefined || row.occurredAt.epochMilliseconds >= input.fromMs,
      )
      .filter((row) => input.toMs === undefined || row.occurredAt.epochMilliseconds < input.toMs)
      .sort((a, b) => b.occurredAt.epochMilliseconds - a.occurredAt.epochMilliseconds)
      .slice(0, input.limit);
    return { rows, nextCursor: null };
  }

  async findEmittedEventById(input: {
    tenantIds: string[];
    id: string;
  }): Promise<WebhookSpendEventRow | null> {
    const separator = input.id.lastIndexOf(":");
    if (separator <= 0 || separator === input.id.length - 1) return null;
    const gatewayRequestId = input.id.slice(0, separator);
    const suffix = input.id.slice(separator + 1);
    const statuses = statusesForSuffix(suffix);
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
    occurredAt: Temporal.Instant.from("2026-07-20T12:00:00.000Z"),
    ...overrides,
  };
}

function eventsDependencies(rows: WebhookSpendEventRow[]): Pick<WebhookAppDependencies, "events"> {
  return {
    events: WebhookEventsService.create({
      tenants: new FakeWebhookTenantsRepository(),
      events: new FakeWebhookEventsRepository(rows),
      envelopes: WebhookEnvelopeService.create(),
    }),
  };
}

const eventsWindow = () => {
  const now = Date.parse("2026-07-20T18:00:00.000Z");
  return `from=${now - 24 * 60 * 60 * 1000}&to=${now}`;
};

describe("the /api/webhooks/v1 door", () => {
  describe("given no entitlement", () => {
    it("answers the entitlement error's own status and code", async () => {
      const { request } = mountWebhookRest({
        assertEndpointsEntitled: async () => {
          throw new WebhookEndpointsNotEntitledError();
        },
      });

      const response = await request("/api/webhooks/v1/endpoints");

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("webhook_endpoints_not_entitled");
    });
  });

  describe("given the endpoints CRUD surface", () => {
    it("creates a http endpoint and returns its secret once", async () => {
      const created = {
        id: "endpoint-1",
        organizationId: ORGANIZATION_ID,
        destinationKind: "http" as const,
        url: "https://example.test/hook",
        sqs: null,
        enabledEvents: ["gateway.request.completed"],
        status: "ACTIVE" as const,
        disabledReason: null,
        disabledAt: null,
        failingSince: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        maxBatchSize: 50,
        maxBatchDelayMs: 5000,
        maxInFlight: 4,
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        updatedAt: new Date("2026-07-20T00:00:00.000Z"),
      };
      const { request } = mountWebhookRest({
        endpoints: createApiFixture<WebhookAppDependencies["endpoints"]>({
          create: async () => ({ endpoint: created, secret: "whsec_test" }),
        }),
      });

      const response = await request("/api/webhooks/v1/endpoints", {
        method: "POST",
        body: JSON.stringify({
          url: "https://example.test/hook",
          enabled_events: ["gateway.request.completed"],
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { secret: string; destination_kind: string };
      expect(body.secret).toBe("whsec_test");
      expect(body.destination_kind).toBe("http");
    });

    it("refuses a create naming both a http and an sqs destination", async () => {
      const { request } = mountWebhookRest();

      const response = await request("/api/webhooks/v1/endpoints", {
        method: "POST",
        body: JSON.stringify({
          url: "https://example.test/hook",
          sqs: { queue_url: "https://sqs.us-east-1.amazonaws.com/1/q" },
          enabled_events: ["gateway.request.completed"],
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("the events log serves what it says it serves", () => {
    /** @scenario An event id the log cannot answer for is a canonical 404 */
    it("answers a canonical 404 for an event id this organization's log does not hold", async () => {
      const { request } = mountWebhookRest(eventsDependencies([]));
      const res = await request("/api/webhooks/v1/events/req_nothing_here:completed");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("webhook_event_not_found");
    });

    /** @scenario A malformed event id is refused the same way as a missing one */
    it("404s an id naming no event the log ever minted, including an admitted row", async () => {
      const { request } = mountWebhookRest(
        eventsDependencies([spendRow({ gatewayRequestId: "req-x", status: "confirmed" })]),
      );

      for (const id of ["no-suffix", "req-x:admitted", "req-x:invented", "req-y:completed"]) {
        const res = await request(`/api/webhooks/v1/events/${encodeURIComponent(id)}`);
        expect(res.status).toBe(404);
      }
    });

    /** @scenario "Emitted events are tenant scoped" */
    it("maps only rows from the organization's own tenants into envelopes", async () => {
      const { request } = mountWebhookRest(
        eventsDependencies([
          spendRow({ gatewayRequestId: "req-mine" }),
          spendRow({ gatewayRequestId: "req-theirs", tenantId: "proj-someone-else" }),
        ]),
      );

      const listed = await request(`/api/webhooks/v1/events?${eventsWindow()}`);
      expect(listed.status).toBe(200);
      const body = (await listed.json()) as { data: { id: string }[] };
      expect(body.data.map((event) => event.id)).toEqual(["req-mine:completed"]);

      const theirs = await request("/api/webhooks/v1/events/req-theirs:completed");
      expect(theirs.status).toBe(404);
    });

    /** @scenario The governance families are absent from the log, not merely empty by chance */
    it("serves an empty page for the governance families it does not retain", async () => {
      const { request } = mountWebhookRest(eventsDependencies([spendRow({})]));

      for (const type of [
        "gateway.budget.threshold_crossed",
        "gateway.budget.breached",
        "gateway.virtual_key.created",
      ]) {
        const res = await request(`/api/webhooks/v1/events?type=${type}&${eventsWindow()}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: unknown[]; next_cursor: string | null };
        expect(body.data).toEqual([]);
        expect(body.next_cursor).toBeNull();
      }
    });

    /** @scenario The events log refuses a read with no created range */
    it("refuses a listing that names no window, naming the missing bound", async () => {
      const { request } = mountWebhookRest(eventsDependencies([]));
      const now = Date.parse("2026-07-20T18:00:00.000Z");
      const cases = [
        { query: "", missing: "from" },
        { query: `?from=${now - 60_000}`, missing: "to" },
        { query: `?to=${now}`, missing: "from" },
      ] as const;

      for (const { query, missing } of cases) {
        const res = await request(`/api/webhooks/v1/events${query}`);
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: { code: string; meta?: { target?: string; fields?: string[] } };
        };
        expect(body.error.code).toBe("validation_error");
        expect(body.error.meta?.fields).toEqual(expect.arrayContaining([missing]));
      }
    });

    /** @scenario The events log refuses an inverted created range */
    it("refuses a window that ends before it starts", async () => {
      const { request } = mountWebhookRest(eventsDependencies([]));
      const now = Date.parse("2026-07-20T18:00:00.000Z");
      const res = await request(`/api/webhooks/v1/events?from=${now}&to=${now - 60_000}`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_error");
    });
  });
});
