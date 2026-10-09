// SPDX-License-Identifier: Apache-2.0

/**
 * `/api/webhooks/v1`, through the real `webhookRest` declaration mounted on a
 * package-local runtime. Covers the entitlement gate, the CRUD wire shape and
 * the events log's ranged-read contract.
 * @see specs/webhooks/webhook-endpoints.feature
 * @see modules/webhook/specs/webhooks.feature
 */
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import {
  endpointArchivedResponseSchema,
  endpointResponseSchema,
  endpointWithSecretResponseSchema,
  webhookEventResponseSchema,
  WebhookEndpointsNotEntitledError,
  type WebhookSpendEventRow,
} from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type { WebhookAppDependencies } from "../../app/webhook.app.ts";
import { WebhookEnvelopeService } from "../../services/webhook-envelope.service.ts";
import { WebhookEventsService } from "../../services/webhook-events.service.ts";
import { mountWebhookRest, ORGANIZATION_ID } from "./webhook-rest.harness.ts";

const PROJECT_ID = "proj-events-1";

/**
 * An in-memory stand-in for gateway's spend reads. Webhook names the statuses (so an
 * `admitted` row is never asked for, and an unknown `type` asks for none); this answers
 * the matching rows newest first, as gateway does.
 */
function fakeGatewaySpend(
  rows: WebhookSpendEventRow[],
): Pick<GatewayApi, "listSpendEventsAcrossTenants" | "findSpendEventAcrossTenants"> {
  return {
    listSpendEventsAcrossTenants: async (input) => ({
      rows: rows
        .filter((row) => input.tenantIds.includes(row.tenantId))
        .filter((row) => input.statuses.includes(row.status))
        .filter(
          (row) => input.fromMs === undefined || row.occurredAt.epochMilliseconds >= input.fromMs,
        )
        .filter((row) => input.toMs === undefined || row.occurredAt.epochMilliseconds < input.toMs)
        .toSorted((a, b) => b.occurredAt.epochMilliseconds - a.occurredAt.epochMilliseconds)
        .slice(0, input.limit),
      nextCursor: null,
    }),
    findSpendEventAcrossTenants: async (input) =>
      rows.find(
        (row) =>
          input.tenantIds.includes(row.tenantId) &&
          row.gatewayRequestId === input.gatewayRequestId &&
          input.statuses.includes(row.status),
      ) ?? null,
  };
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
    tokensInputImage: 0,
    tokensOutputImage: 0,
    imageCount: 0,
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
      projects: { listIdsByOrganization: async () => [PROJECT_ID] },
      spend: fakeGatewaySpend(rows),
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
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("webhook_endpoints_not_entitled");
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
      const body = endpointWithSecretResponseSchema.parse(await response.json());
      expect(body.data.secret).toBe("whsec_test");
      expect(body.data.destination_kind).toBe("http");
    });

    it("answers a single endpoint under `data`, its queue URL included", async () => {
      const sqsEndpoint = {
        id: "endpoint-sqs",
        organizationId: ORGANIZATION_ID,
        destinationKind: "sqs" as const,
        url: null,
        sqs: {
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/spend",
          region: "us-east-1",
          accountId: "123456789012",
          queueName: "spend",
          credentialMode: "assume_role" as const,
          roleArn: "arn:aws:iam::123456789012:role/lw",
          externalId: "ext-1",
          accessKeyId: null,
        },
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
          getById: async () => sqsEndpoint,
          archive: async () => undefined,
        }),
      });

      const read = await request("/api/webhooks/v1/endpoints/endpoint-sqs");
      expect(read.status).toBe(200);
      const body = endpointResponseSchema.parse(await read.json());
      expect(body.data.sqs?.queue_url).toBe(sqsEndpoint.sqs.queueUrl);

      const archived = await request("/api/webhooks/v1/endpoints/endpoint-sqs", {
        method: "DELETE",
      });
      expect(archived.status).toBe(200);
      expect(endpointArchivedResponseSchema.parse(await archived.json())).toEqual({
        data: { archived: true },
      });
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

  describe("given the events log serves what it says it serves", () => {
    /** @scenario An event id the log cannot answer for is a canonical 404 */
    it("answers a canonical 404 for an event id this organization's log does not hold", async () => {
      const { request } = mountWebhookRest(eventsDependencies([]));
      const res = await request("/api/webhooks/v1/events/req_nothing_here:completed");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("webhook_event_not_found");
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
    /** @scenario "The webhook events listing answers the same envelopes through gateway" */
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

      const mine = await request("/api/webhooks/v1/events/req-mine:completed");
      expect(mine.status).toBe(200);
      expect(webhookEventResponseSchema.parse(await mine.json()).data.id).toBe(
        "req-mine:completed",
      );

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
          code: string;
          meta?: { target?: string; fields?: string[] };
        };
        expect(body.code).toBe("validation_error");
        expect(body.meta?.fields).toEqual(expect.arrayContaining([missing]));
      }
    });

    /** @scenario The events log refuses an inverted created range */
    it("refuses a window that ends before it starts", async () => {
      const { request } = mountWebhookRest(eventsDependencies([]));
      const now = Date.parse("2026-07-20T18:00:00.000Z");
      const res = await request(`/api/webhooks/v1/events?from=${now}&to=${now - 60_000}`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("validation_error");
    });
  });
});

describe("every list on the /api/webhooks/v1 surface", () => {
  /** @scenario "A webhook list answers under its own data envelope" */
  it("answers under `data`, because next_cursor has nowhere to live beside a bare array", async () => {
    const { request } = mountWebhookRest({
      endpoints: createApiFixture<WebhookAppDependencies["endpoints"]>({
        findAll: async () => [],
      }),
    });

    const endpoints = await request("/api/webhooks/v1/endpoints");
    expect(endpoints.status).toBe(200);
    await expect(endpoints.json()).resolves.toEqual({ data: [] });

    const eventTypes = await request("/api/webhooks/v1/event-types");
    expect(eventTypes.status).toBe(200);
    const catalogue = (await eventTypes.json()) as { data?: unknown[] };
    expect(Array.isArray(catalogue.data)).toBe(true);
    expect(catalogue.data?.length).toBeGreaterThan(0);
  });
});
