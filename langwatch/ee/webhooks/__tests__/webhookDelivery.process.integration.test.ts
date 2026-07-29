// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The delivery pipeline against real ClickHouse and Postgres: scan slots
 * turning spend rows into committed outbox batches with first-sight
 * markers, and batch sends recording the receiver's answers. The HTTP
 * sender is mocked; everything else is the real machinery.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization, Project, Team } from "@prisma/client";
import { prisma } from "~/server/db";
import { InMemoryProcessStore } from "~/server/event-sourcing/process-manager/stores/inMemoryProcessStore";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  GatewaySpendEventsRepository,
  type SpendEventRow,
} from "~/server/gateway/spendEvents.clickhouse.repository";
import { WebhookEventsClickHouseRepository } from "../webhookEvents.clickhouse.repository";
import { WebhookEndpointService } from "../webhookEndpoint.service";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  runWebhookScan,
  runWebhookSendBatch,
  type SendBatchPayload,
  type WebhookDeliveryProcessDeps,
} from "../process-manager/webhookDelivery.process";

vi.mock("~/server/app-layer/automations/delivery/sendWebhook", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/server/app-layer/automations/delivery/sendWebhook")>();
  return { ...original, sendWebhook: vi.fn() };
});
import { sendWebhook } from "~/server/app-layer/automations/delivery/sendWebhook";
const sendWebhookMock = vi.mocked(sendWebhook);

const ns = `webhook-pm-${nanoid(8)}`;

let client: ClickHouseClient;
let spendRepo: GatewaySpendEventsRepository;
let eventsRepository: WebhookEventsClickHouseRepository;
let endpoints: WebhookEndpointService;
let store: InMemoryProcessStore;
let deps: WebhookDeliveryProcessDeps;

let organization: Organization;
let team: Team;
let project: Project;
let endpointId: string;

const baseTime = Date.UTC(2026, 6, 20, 12, 0, 0);
let clock: number;

function spendRow(
  requestId: string,
  overrides: Partial<SpendEventRow> = {},
): SpendEventRow {
  return {
    tenantId: project.id,
    gatewayRequestId: requestId,
    organizationId: organization.id,
    teamId: team.id,
    virtualKeyId: "vk-test",
    principalUserId: "",
    endUserId: "end-user-1",
    traceId: `trace-${requestId}`,
    model: "openai/gpt-5",
    providerKey: "provider-1",
    tokensInput: 100,
    tokensOutput: 10,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensReasoning: 0,
    costUsd: "0.001000",
    status: "success",
    errorClass: "",
    httpStatus: 200,
    labels: [],
    metadata: "",
    durationMs: 500,
    occurredAt: new Date(baseTime),
    ...overrides,
  };
}

async function runScan(): Promise<void> {
  clock += 20_000;
  await runWebhookScan(deps)({ scheduledFor: clock }, {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId: "__global__",
    processKey: WEBHOOK_DELIVERY_PROCESS_NAME,
    tenantId: "__global__",
    messageKey: `process:${WEBHOOK_DELIVERY_PROCESS_NAME}:scan:${clock}`,
    attempt: 1,
  });
}

async function pendingSendMessages() {
  const messages = await store.findMessagesByRef({
    ref: {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: project.id,
      processKey: project.id,
    },
  });
  return messages.filter(
    (m) => m.intentType === "sendBatch" && m.status === "pending",
  );
}

beforeAll(async () => {
  const containers = await startTestContainers();
  client = containers.clickHouseClient;
  const resolve = async () => client;
  spendRepo = new GatewaySpendEventsRepository(resolve);
  eventsRepository = new WebhookEventsClickHouseRepository(resolve);
  endpoints = new WebhookEndpointService({ prisma });

  organization = await prisma.organization.create({
    data: { name: "Webhook PM Org", slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: "Webhook PM Team",
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  project = await prisma.project.create({
    data: {
      name: "Webhook PM Project",
      slug: `--test-project-${ns}`,
      teamId: team.id,
      language: "other",
      framework: "other",
      apiKey: `test-key-${ns}`,
    },
  });
  const created = await endpoints.create({
    organizationId: organization.id,
    url: "https://receiver.example.com/hooks",
    enabledEvents: ["gateway.request.completed"],
  });
  endpointId = created.endpoint.id;

  // Keep the sweep hermetic: this suite's org only, whatever else the
  // shared test database currently holds.
  vi.spyOn(endpoints, "organizationIdsWithActiveEndpoints").mockResolvedValue([
    organization.id,
  ]);
}, 120_000);

afterAll(async () => {
  if (client && project) {
    await client.command({
      query: `ALTER TABLE gateway_spend_events DELETE WHERE TenantId = '${project.id}'`,
    });
    await client.command({
      query: `ALTER TABLE webhook_delivered_events DELETE WHERE TenantId = '${project.id}'`,
    });
  }
  await prisma.webhookEndpointDelivery.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.webhookEndpoint.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.project.delete({ where: { id: project.id } });
  await prisma.team.delete({ where: { id: team.id } });
  await prisma.organization.delete({ where: { id: organization.id } });
  await stopTestContainers();
});

beforeEach(() => {
  store = new InMemoryProcessStore();
  clock = Date.now();
  deps = {
    prisma,
    processStore: store,
    eventsRepository,
    endpoints,
    getPlan: async () =>
      ({ webhookEndpoints: true }) as Awaited<
        ReturnType<WebhookDeliveryProcessDeps["getPlan"]>
      >,
    now: () => clock,
  };
  sendWebhookMock.mockReset();
});

describe("webhook delivery scan", () => {
  /** @scenario One spend record becomes exactly one delivery batch entry */
  it("freezes a never-seen spend record into one batch and marks first sight", async () => {
    const requestId = `req-${nanoid(8)}`;
    await spendRepo.insertSpendEvents([spendRow(requestId)]);

    await runScan();

    const sends = await pendingSendMessages();
    expect(sends).toHaveLength(1);
    const payload = sends[0]!.payload as unknown as SendBatchPayload;
    expect(payload.endpointId).toBe(endpointId);
    expect(payload.envelopes.map((e) => e.id)).toEqual([requestId]);

    const marked = await eventsRepository.probeDelivered({
      tenantId: project.id,
      requestIds: [requestId],
    });
    expect(marked.has(requestId)).toBe(true);

    // The same store re-scanned: nothing new, no duplicate batch.
    await runScan();
    expect(await pendingSendMessages()).toHaveLength(1);
  });

  /** @scenario A restated spend record is never re-emitted as completed */
  it("ignores a newer version of an already-enqueued request id", async () => {
    const requestId = `req-${nanoid(8)}`;
    await spendRepo.insertSpendEvents([spendRow(requestId)]);
    await runScan();
    expect(await pendingSendMessages()).toHaveLength(1);

    // A restatement writes a newer RMT version directly (the app-side
    // insert probe skips same-id writes; a future corrections path would
    // not). The scan must not re-emit completed for it.
    await client.insert({
      table: "gateway_spend_events",
      values: [
        {
          TenantId: project.id,
          GatewayRequestId: requestId,
          OrganizationId: organization.id,
          TeamId: team.id,
          VirtualKeyId: "vk-test",
          PrincipalUserId: "",
          EndUserId: "end-user-1",
          TraceId: `trace-${requestId}`,
          Model: "openai/gpt-5",
          ProviderKey: "provider-1",
          TokensInput: 120,
          TokensOutput: 12,
          TokensCacheRead: 0,
          TokensCacheWrite: 0,
          TokensReasoning: 0,
          CostUSD: "0.002000",
          Status: "success",
          ErrorClass: "",
          HttpStatus: 200,
          Labels: [],
          Metadata: "",
          DurationMS: 600,
          OccurredAt: baseTime,
          EventTimestamp: Date.now() + 60_000,
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });

    await runScan();
    expect(await pendingSendMessages()).toHaveLength(1);
  });

  /** @scenario Batches and the cursor commit atomically, marker failures lose nothing */
  it("keeps committed batches when the marker write fails, and retries markers", async () => {
    const requestId = `req-${nanoid(8)}`;
    await spendRepo.insertSpendEvents([spendRow(requestId)]);

    const markSpy = vi
      .spyOn(eventsRepository, "markEnqueued")
      .mockRejectedValueOnce(new Error("clickhouse hiccup"));

    await runScan();

    // The batch commit preceded the marker failure and survives it; the
    // in-scan retry landed the markers on the second attempt.
    expect(await pendingSendMessages()).toHaveLength(1);
    expect(markSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const marked = await eventsRepository.probeDelivered({
      tenantId: project.id,
      requestIds: [requestId],
    });
    expect(marked.has(requestId)).toBe(true);
    markSpy.mockRestore();
  });

  /** @scenario The events listing pages the organization's emitted events */
  it("pages emitted envelopes newest first with a continuation cursor", async () => {
    const ids = [1, 2, 3].map((i) => `req-page-${i}-${nanoid(6)}`);
    await spendRepo.insertSpendEvents(
      ids.map((id, i) =>
        spendRow(id, { occurredAt: new Date(baseTime + i * 1000) }),
      ),
    );

    const first = await eventsRepository.readEmittedEventsPage({
      tenantIds: [project.id],
      fromMs: baseTime - 1,
      toMs: baseTime + 60_000,
      limit: 2,
    });
    expect(first.rows.length).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.rows[0]!.occurredAt.getTime()).toBeGreaterThanOrEqual(
      first.rows[1]!.occurredAt.getTime(),
    );

    const second = await eventsRepository.readEmittedEventsPage({
      tenantIds: [project.id],
      fromMs: baseTime - 1,
      toMs: baseTime + 60_000,
      cursor: first.nextCursor,
      limit: 2,
    });
    const seen = new Set([
      ...first.rows.map((r) => r.gatewayRequestId),
      ...second.rows.map((r) => r.gatewayRequestId),
    ]);
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });
});

describe("webhook batch send", () => {
  function sendPayload(requestId: string): SendBatchPayload {
    return {
      organizationId: organization.id,
      projectId: project.id,
      endpointId,
      batchId: `${endpointId}:test-${nanoid(6)}`,
      envelopes: [
        {
          id: requestId,
          type: "gateway.request.completed",
          created: new Date(baseTime).toISOString(),
          schema_version: "1",
          data: { event_id: requestId },
        },
      ],
    };
  }

  const intentContext = (attempt = 1) => ({
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId: project.id,
    processKey: project.id,
    tenantId: project.id,
    messageKey: "send:test",
    attempt,
  });

  /** @scenario The receiver's status code is stored on every attempt */
  it("records the receiver's 5xx with latency and rethrows retryable", async () => {
    sendWebhookMock.mockResolvedValue({
      status: 503,
      body: "upstream down",
      eventId: "batch-1",
      retryAfterMs: 30_000,
    });
    const payload = sendPayload(`req-${nanoid(6)}`);

    await expect(
      runWebhookSendBatch(deps)(payload, intentContext(1)),
    ).rejects.toMatchObject({ retryable: true, retryAfterMs: 30_000 });

    const deliveries = await endpoints.listDeliveries({
      organizationId: organization.id,
      endpointId,
    });
    const row = deliveries.find((d) => d.dispatchId === payload.batchId);
    expect(row).toMatchObject({
      outcome: "retryable",
      responseStatus: 503,
      attempt: 1,
      eventCount: 1,
    });

    // The signed request carried the delivery headers.
    const call = sendWebhookMock.mock.calls[0]![0];
    expect(call.signingSecret).toMatch(/^whsec_/);
    expect(call.attempt).toBe(1);
    expect(call.eventId).toBe(payload.batchId);
  });

  it("a 2xx acks: success row, no throw", async () => {
    sendWebhookMock.mockResolvedValue({
      status: 200,
      body: "ok",
      eventId: "batch-2",
    });
    const payload = sendPayload(`req-${nanoid(6)}`);
    await runWebhookSendBatch(deps)(payload, intentContext(2));

    const deliveries = await endpoints.listDeliveries({
      organizationId: organization.id,
      endpointId,
    });
    expect(
      deliveries.find((d) => d.dispatchId === payload.batchId),
    ).toMatchObject({ outcome: "success", responseStatus: 200, attempt: 2 });
  });

  it("a non-retryable 4xx records terminal and throws retryable false", async () => {
    sendWebhookMock.mockResolvedValue({
      status: 404,
      body: "gone",
      eventId: "batch-3",
    });
    const payload = sendPayload(`req-${nanoid(6)}`);
    await expect(
      runWebhookSendBatch(deps)(payload, intentContext(1)),
    ).rejects.toMatchObject({ retryable: false });

    const deliveries = await endpoints.listDeliveries({
      organizationId: organization.id,
      endpointId,
    });
    expect(
      deliveries.find((d) => d.dispatchId === payload.batchId),
    ).toMatchObject({ outcome: "terminal", responseStatus: 404 });
  });

  /** @scenario A disabled endpoint drains its queue without posting */
  it("drops the batch without posting when the endpoint is disabled", async () => {
    await endpoints.disable({
      organizationId: organization.id,
      endpointId,
    });
    try {
      const payload = sendPayload(`req-${nanoid(6)}`);
      await runWebhookSendBatch(deps)(payload, intentContext(1));
      expect(sendWebhookMock).not.toHaveBeenCalled();
    } finally {
      await endpoints.enable({
        organizationId: organization.id,
        endpointId,
      });
    }
  });
});
