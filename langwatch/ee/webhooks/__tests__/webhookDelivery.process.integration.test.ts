// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The delivery process manager end to end against real Postgres: spend
 * pipeline events consumed through the transactional inbox, the deliver
 * fan-out committing per-endpoint send messages, and the send executor
 * recording the receiver's answers. The HTTP sender is mocked; the
 * definition under test is the EXACT one the runtime mounts, built through
 * the pipeline's own applier.
 */

import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "~/server/db";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import {
  InMemoryProcessStore,
  type ProcessDefinition,
  ProcessManagerService,
} from "~/server/event-sourcing/process-manager";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager/outbox/outboxDispatcherService";
import type { ProcessEventEnvelope } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type WebhookDeliveryProcessDeps,
  type WebhookDeliveryState,
  webhookDeliveryPM,
} from "../process-manager/webhookDelivery.process";
import { WebhookEndpointService } from "../webhookEndpoint.service";
import { WebhookHealthService } from "../webhookHealth.service";

vi.mock(
  "~/server/app-layer/automations/delivery/sendWebhook",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("~/server/app-layer/automations/delivery/sendWebhook")
      >();
    return { ...original, sendWebhook: vi.fn() };
  },
);

import { sendWebhook } from "~/server/app-layer/automations/delivery/sendWebhook";

const sendWebhookMock = vi.mocked(sendWebhook);

const ns = `webhook-pm-${nanoid(8)}`;
const T0 = Date.UTC(2026, 6, 20, 12, 0, 0);

let organization: Organization;
let team: Team;
let project: Project;
let endpointId: string;

const endpoints = new WebhookEndpointService({ prisma });

let store: InMemoryProcessStore;
let service: ProcessManagerService<WebhookDeliveryState>;
let dispatcher: OutboxDispatcherService;
let deps: WebhookDeliveryProcessDeps;
let clock: number;

function buildDefinition(d: WebhookDeliveryProcessDeps) {
  return buildProcessDefinition(
    buildProcessManager({
      name: WEBHOOK_DELIVERY_PROCESS_NAME,
      applier: webhookDeliveryPM(d),
    }).config,
  ) as ProcessDefinition<WebhookDeliveryState>;
}

function envelopeFor({
  requestId,
  eventType,
  data,
  occurredAt,
}: {
  requestId: string;
  eventType: string;
  data: Record<string, unknown>;
  occurredAt: number;
}): ProcessEventEnvelope {
  return {
    eventId: `${eventType}:${requestId}`,
    eventType,
    occurredAt,
    tenantId: project.id,
    projectId: project.id,
    processKey: requestId,
    payload: data as ProcessEventEnvelope["payload"],
  };
}

function admittedEnvelope(requestId: string): ProcessEventEnvelope {
  return envelopeFor({
    requestId,
    eventType: GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
    occurredAt: T0,
    data: {
      gateway_request_id: requestId,
      occurred_at: T0,
      organization_id: organization.id,
      tenantId: project.id,
      virtual_key_id: "vk-test",
      principal_user_id: "",
      end_user_id: "end-user-1",
      model: "openai/gpt-5",
      model_provider_id: "provider-1",
      trace_id: `trace-${requestId}`,
      request_type: "chat",
      labels: ["team:acme"],
      metadata: '{"call_site":"summary"}',
      pod_id: "pod-1",
      pod_seq: 1,
    },
  });
}

function confirmedEnvelope(requestId: string): ProcessEventEnvelope {
  return envelopeFor({
    requestId,
    eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    occurredAt: T0 + 3000,
    data: {
      gateway_request_id: requestId,
      occurred_at: T0 + 3000,
      tenantId: project.id,
      model: "openai/gpt-5",
      model_provider_id: "provider-1",
      usage: {
        input_tokens: 869,
        output_tokens: 207,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_tokens: 0,
      },
      rate_version: "catalog@2026-07-26",
      duration_ms: 3878,
    },
  });
}

function failedEnvelope(requestId: string): ProcessEventEnvelope {
  return envelopeFor({
    requestId,
    eventType: GATEWAY_SPEND_FAILED_EVENT_TYPE,
    occurredAt: T0 + 1500,
    data: {
      gateway_request_id: requestId,
      occurred_at: T0 + 1500,
      tenantId: project.id,
      model: "openai/gpt-5",
      model_provider_id: "provider-1",
      error: { type: "provider_timeout", http_status: 504 },
      usage: {
        input_tokens: 869,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_tokens: 0,
      },
      duration_ms: 1509,
    },
  });
}

function settledEnvelope(requestId: string): ProcessEventEnvelope {
  return envelopeFor({
    requestId,
    eventType: GATEWAY_SPEND_SETTLED_EVENT_TYPE,
    occurredAt: T0 + 600_000,
    data: {
      gateway_request_id: requestId,
      occurred_at: T0 + 600_000,
      tenantId: project.id,
      reason: "confirmation_deadline_expired",
    },
  });
}

/** A revision conflict here means the test raced its own setup, not that
 *  the subject misbehaved, so it fails on the spot with the event that hit
 *  it rather than as a puzzling assertion further down. */
async function consume(envelope: ProcessEventEnvelope): Promise<void> {
  const result = await service.handleEvent({ envelope, now: clock });
  if (result.outcome === "revisionConflict") {
    throw new Error(
      `process manager hit a revision conflict consuming ${envelope.eventType} for ${envelope.processKey}`,
    );
  }
}

async function drainOutbox(passes = 6): Promise<void> {
  for (let i = 0; i < passes; i++) {
    clock += 1000;
    await dispatcher.runOnce({ now: clock, limit: 50 });
  }
}

async function endpointStream(endpoint: string) {
  return store.findByRef<{ pending: Array<{ appendedAtMs: number }> }>({
    ref: {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: project.id,
      processKey: `endpoint:${endpoint}`,
    },
  });
}

async function wakeEndpoint(endpoint: string) {
  const instance = await endpointStream(endpoint);
  if (!instance || instance.nextWakeAt === null) return false;
  const result = await service.handleWake({
    wake: {
      ref: {
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        projectId: project.id,
        processKey: `endpoint:${endpoint}`,
      },
      revision: instance.revision,
      wakeAt: instance.nextWakeAt,
    },
    now: clock,
  });
  return result.outcome === "committed";
}

async function sendMessagesFor(endpoint: string) {
  const messages = await store.findMessagesByRef({
    ref: {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: project.id,
      processKey: `endpoint:${endpoint}`,
    },
  });
  return messages.filter((m) => m.intentType === "sendBatch");
}

beforeAll(async () => {
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
    // The suite pins immediate mode; coalescing tests override per test.
    maxBatchDelayMs: 0,
  });
  endpointId = created.endpoint.id;
});

afterAll(async () => {
  await prisma.webhookEndpointDelivery.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.webhookEndpoint.deleteMany({
    where: { organizationId: organization.id },
  });
  await prisma.project.delete({ where: { id: project.id } });
  await prisma.team.delete({ where: { id: team.id } });
  await prisma.organization.delete({ where: { id: organization.id } });
});

beforeEach(() => {
  store = new InMemoryProcessStore();
  clock = Date.now();
  deps = {
    processStore: store,
    endpoints,
    getPlan: async () =>
      ({ webhookEndpointsEnabled: true }) as Awaited<
        ReturnType<WebhookDeliveryProcessDeps["getPlan"]>
      >,
    now: () => clock,
  };
  service = new ProcessManagerService({
    definition: buildDefinition(deps),
    store,
  });
  dispatcher = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(
      buildProcessManager({
        name: WEBHOOK_DELIVERY_PROCESS_NAME,
        applier: webhookDeliveryPM(deps),
      }).config,
    ),
    processNames: [WEBHOOK_DELIVERY_PROCESS_NAME],
  });
  sendWebhookMock.mockReset();
  sendWebhookMock.mockResolvedValue({
    status: 200,
    body: "ok",
    eventId: "x",
  });
});

describe("webhook delivery via the transactional inbox", () => {
  /** @scenario A confirmed spend event becomes exactly one delivery per endpoint */
  it("joins admission attribution with the outcome into one send per endpoint", async () => {
    const requestId = `req-${nanoid(8)}`;
    await consume(admittedEnvelope(requestId));
    await consume(confirmedEnvelope(requestId));
    await drainOutbox();

    const sends = await sendMessagesFor(endpointId);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.status).toBe("dispatched");

    expect(sendWebhookMock).toHaveBeenCalledTimes(1);
    const call = sendWebhookMock.mock.calls[0]![0];
    expect(call.signingSecret).toMatch(/^whsec_/);
    const body = JSON.parse(call.body) as {
      batch: Array<{ id: string; data: Record<string, unknown> }>;
    };
    expect(body.batch).toHaveLength(1);
    expect(body.batch[0]!.id).toBe(`${requestId}:completed`);
    expect(body.batch[0]!.data.gateway_request_id).toBe(requestId);
    expect(body.batch[0]!.data.organization_id).toBe(organization.id);
    expect(body.batch[0]!.data.end_user_id).toBe("end-user-1");
    expect(body.batch[0]!.data.status).toBe("success");
    const cost = body.batch[0]!.data.cost as { nano_usd: number };
    expect(cost.nano_usd).toBeGreaterThan(0);
    expect(Number.isInteger(cost.nano_usd)).toBe(true);
  });

  /** @scenario A redelivered event never queues a second envelope */
  it("absorbs a redelivered confirmed event in the inbox", async () => {
    const requestId = `req-${nanoid(8)}`;
    await consume(admittedEnvelope(requestId));
    await consume(confirmedEnvelope(requestId));

    const redelivery = await service.handleEvent({
      envelope: confirmedEnvelope(requestId),
      now: clock + 10,
    });
    expect(redelivery.outcome).toBe("duplicateEvent");

    await drainOutbox();
    expect(await sendMessagesFor(endpointId)).toHaveLength(1);
    expect(sendWebhookMock).toHaveBeenCalledTimes(1);
  });

  /** @scenario A settled request goes out as its own event type */
  it("delivers a settlement as gateway.request.settled with unknown cost", async () => {
    await endpoints.update({
      organizationId: organization.id,
      endpointId,
      enabledEvents: ["gateway.*"],
    });
    try {
      const requestId = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(requestId));
      await consume(settledEnvelope(requestId));
      await drainOutbox();

      expect(sendWebhookMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(sendWebhookMock.mock.calls[0]![0].body) as {
        batch: Array<{
          id: string;
          type: string;
          data: Record<string, unknown>;
        }>;
      };
      expect(body.batch[0]!.type).toBe("gateway.request.settled");
      expect(body.batch[0]!.id).toBe(`${requestId}:settled`);
      expect(body.batch[0]!.data.cost).toBeNull();
      expect(body.batch[0]!.data.usage).toBeNull();
      expect(body.batch[0]!.data.needs_reconciliation).toBe(true);
      expect(body.batch[0]!.data.settle_reason).toBe(
        "confirmation_deadline_expired",
      );
    } finally {
      await endpoints.update({
        organizationId: organization.id,
        endpointId,
        enabledEvents: ["gateway.request.completed"],
      });
    }
  });

  /** @scenario A late confirmation supersedes the settled event */
  it("delivers the real completed envelope after a settlement, distinct ids, same join key", async () => {
    await endpoints.update({
      organizationId: organization.id,
      endpointId,
      enabledEvents: ["gateway.*"],
    });
    try {
      const requestId = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(requestId));
      await consume(settledEnvelope(requestId));
      await drainOutbox();
      await consume(confirmedEnvelope(requestId));
      await drainOutbox();

      expect(sendWebhookMock).toHaveBeenCalledTimes(2);
      const bodies = sendWebhookMock.mock.calls.map(
        (call) =>
          (
            JSON.parse(call[0].body) as {
              batch: Array<{
                id: string;
                type: string;
                data: Record<string, unknown>;
              }>;
            }
          ).batch[0]!,
      );
      const settled = bodies.find((b) => b.type === "gateway.request.settled")!;
      const completed = bodies.find(
        (b) => b.type === "gateway.request.completed",
      )!;
      expect(settled).toBeDefined();
      expect(completed).toBeDefined();
      expect(settled.id).not.toBe(completed.id);
      expect(settled.data.gateway_request_id).toBe(requestId);
      expect(completed.data.gateway_request_id).toBe(requestId);
      const cost = completed.data.cost as { nano_usd: number };
      expect(cost.nano_usd).toBeGreaterThan(0);
    } finally {
      await endpoints.update({
        organizationId: organization.id,
        endpointId,
        enabledEvents: ["gateway.request.completed"],
      });
    }
  });

  /** @scenario A completed-only subscription never receives settlements */
  it("skips settled delivery for an endpoint subscribed only to completed", async () => {
    const completedOnly = await endpoints.create({
      organizationId: organization.id,
      url: "https://receiver-completed-only.example.com/hooks",
      maxBatchDelayMs: 0,
      enabledEvents: ["gateway.request.completed"],
    });
    const allGateway = await endpoints.update({
      organizationId: organization.id,
      endpointId,
      enabledEvents: ["gateway.*"],
    });
    expect(allGateway.enabledEvents).toEqual(["gateway.*"]);
    try {
      const requestId = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(requestId));
      await consume(settledEnvelope(requestId));
      await drainOutbox();

      expect(await sendMessagesFor(completedOnly.endpoint.id)).toHaveLength(0);
      expect(await sendMessagesFor(endpointId)).toHaveLength(1);
    } finally {
      await endpoints.update({
        organizationId: organization.id,
        endpointId,
        enabledEvents: ["gateway.request.completed"],
      });
      await endpoints.archive({
        organizationId: organization.id,
        endpointId: completedOnly.endpoint.id,
      });
    }
  });

  /** @scenario Failed requests are delivered as completed with their error class */
  it("delivers a failed request with its error class", async () => {
    const requestId = `req-${nanoid(8)}`;
    await consume(admittedEnvelope(requestId));
    await consume(failedEnvelope(requestId));
    await drainOutbox();

    expect(sendWebhookMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(sendWebhookMock.mock.calls[0]![0].body) as {
      batch: Array<{ data: Record<string, unknown> }>;
    };
    expect(body.batch[0]!.data.status).toBe("error");
    expect(body.batch[0]!.data.error).toEqual({
      class: "provider_timeout",
      http_status: 504,
    });
  });

  /** @scenario The receiver's status code is stored on every attempt */
  it("records the receiver's 5xx per attempt and leaves the message pending", async () => {
    sendWebhookMock.mockResolvedValue({
      status: 503,
      body: "upstream down",
      eventId: "x",
      retryAfterMs: 30_000,
    });
    const requestId = `req-${nanoid(8)}`;
    await consume(admittedEnvelope(requestId));
    await consume(confirmedEnvelope(requestId));
    await drainOutbox(2);

    const sends = await sendMessagesFor(endpointId);
    expect(sends[0]!.status).toBe("pending");
    expect(sends[0]!.attempts).toBeGreaterThanOrEqual(1);

    const deliveries = await endpoints.getDeliveries({
      organizationId: organization.id,
      endpointId,
    });
    // Batch ids are content hashes now; the newest row is this test's batch.
    const row = deliveries.deliveries[0];
    expect(row).toMatchObject({
      outcome: "retryable",
      responseStatus: 503,
      eventCount: 1,
    });
  });

  /** @scenario A disabled endpoint drains its queue without posting */
  it("drops the batch without posting when the endpoint is disabled", async () => {
    const requestId = `req-${nanoid(8)}`;
    await consume(admittedEnvelope(requestId));
    await consume(confirmedEnvelope(requestId));
    // Level 1 fans out while the endpoint is ACTIVE; the disable lands
    // between fan-out and the send, which is the case the drain covers.
    await drainOutbox(1);

    await endpoints.disable({
      organizationId: organization.id,
      endpointId,
    });
    try {
      await drainOutbox();
      expect(sendWebhookMock).not.toHaveBeenCalled();
      const sends = await sendMessagesFor(endpointId);
      expect(sends[0]!.status).toBe("dispatched");
    } finally {
      await endpoints.enable({
        organizationId: organization.id,
        endpointId,
      });
    }
  });

  /** @scenario Envelopes coalesce into one signed batch up to the endpoint's size */
  it("coalesces held envelopes and ships a full batch immediately at the cap", async () => {
    await endpoints.update({
      organizationId: organization.id,
      endpointId,
      maxBatchSize: 2,
      maxBatchDelayMs: 60_000,
      maxInFlight: 4,
    });
    try {
      const first = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(first));
      await consume(confirmedEnvelope(first));
      await drainOutbox(1);
      // One envelope, delay holding, nothing on the wire yet.
      expect(sendWebhookMock).not.toHaveBeenCalled();
      expect((await endpointStream(endpointId))?.state.pending).toHaveLength(1);

      const second = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(second));
      await consume(confirmedEnvelope(second));
      await drainOutbox();

      // The batch filled: it ships without waiting for the delay, one POST,
      // one signature, both event ids inside.
      expect(sendWebhookMock).toHaveBeenCalledTimes(1);
      const call = sendWebhookMock.mock.calls[0]![0];
      expect(call.signingSecret).toMatch(/^whsec_/);
      const body = JSON.parse(call.body) as {
        batch: Array<{ id: string }>;
      };
      expect(body.batch.map((e) => e.id).sort()).toEqual(
        [`${first}:completed`, `${second}:completed`].sort(),
      );
    } finally {
      await endpoints.update({
        organizationId: organization.id,
        endpointId,
        maxBatchSize: 100,
        maxBatchDelayMs: 0,
        maxInFlight: 4,
      });
    }
  });

  /** @scenario A partial batch ships once its delay elapses */
  it("the armed wake flushes a partial batch after the coalescing delay", async () => {
    await endpoints.update({
      organizationId: organization.id,
      endpointId,
      maxBatchSize: 100,
      maxBatchDelayMs: 5_000,
      maxInFlight: 4,
    });
    try {
      const requestId = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(requestId));
      await consume(confirmedEnvelope(requestId));
      await drainOutbox(1);
      expect(sendWebhookMock).not.toHaveBeenCalled();
      expect((await endpointStream(endpointId))?.nextWakeAt).not.toBeNull();

      clock += 6_000;
      expect(await wakeEndpoint(endpointId)).toBe(true);
      await drainOutbox();

      expect(sendWebhookMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(sendWebhookMock.mock.calls[0]![0].body) as {
        batch: Array<{ id: string }>;
      };
      expect(body.batch).toHaveLength(1);
      expect(body.batch[0]!.id).toBe(`${requestId}:completed`);
    } finally {
      await endpoints.update({
        organizationId: organization.id,
        endpointId,
        maxBatchDelayMs: 0,
      });
    }
  });

  /** @scenario Under backpressure batches grow toward the size cap */
  it("accumulates while in-flight is capped and flushes one larger batch", async () => {
    await endpoints.update({
      organizationId: organization.id,
      endpointId,
      maxBatchSize: 100,
      maxBatchDelayMs: 0,
      maxInFlight: 1,
    });
    try {
      sendWebhookMock.mockResolvedValue({
        status: 503,
        body: "slow receiver",
        eventId: "x",
      });
      const first = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(first));
      await consume(confirmedEnvelope(first));
      await drainOutbox(1);
      // The single in-flight slot is burning retries on the first batch.
      expect((await sendMessagesFor(endpointId))[0]!.status).toBe("pending");

      const later = [1, 2, 3].map(() => `req-${nanoid(8)}`);
      for (const id of later) {
        await consume(admittedEnvelope(id));
        await consume(confirmedEnvelope(id));
      }
      await drainOutbox(1);
      // Capped: the three newcomers buffered instead of new POSTs.
      expect((await endpointStream(endpointId))?.state.pending).toHaveLength(3);

      // The receiver recovers; the retry ladder's next attempt succeeds and
      // frees the slot, and the wake flushes the accumulated three as ONE
      // batch: the climb toward the cap.
      sendWebhookMock.mockResolvedValue({
        status: 200,
        body: "ok",
        eventId: "x",
      });
      clock += 61_000;
      await drainOutbox(2);
      expect(await wakeEndpoint(endpointId)).toBe(true);
      await drainOutbox();

      const bodies = sendWebhookMock.mock.calls.map(
        (call) => (JSON.parse(call[0].body) as { batch: unknown[] }).batch,
      );
      const flushed = bodies[bodies.length - 1]!;
      expect(flushed).toHaveLength(3);
    } finally {
      await endpoints.update({
        organizationId: organization.id,
        endpointId,
        maxBatchDelayMs: 0,
        maxInFlight: 4,
      });
    }
  });

  /** @scenario The health report leads with the oldest undelivered age */
  it("reports lag from the stalest buffered envelope and counts the DLQ", async () => {
    await endpoints.update({
      organizationId: organization.id,
      endpointId,
      maxBatchSize: 100,
      maxBatchDelayMs: 60_000,
      maxInFlight: 4,
    });
    try {
      const requestId = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(requestId));
      await consume(confirmedEnvelope(requestId));
      await drainOutbox(1);

      clock += 30_000;
      const healthService = new WebhookHealthService({
        prisma,
        endpoints,
        processStore: store,
        now: () => clock,
      });
      const report = await healthService.health({
        organizationId: organization.id,
        endpointId,
      });
      expect(report.oldestUndeliveredAgeMs).not.toBeNull();
      expect(report.oldestUndeliveredAgeMs!).toBeGreaterThanOrEqual(30_000);
      expect(report.dlqDepth).toBe(0);

      // Fabricate a dead batch: it counts as DLQ depth.
      const ref = {
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        projectId: project.id,
        processKey: `endpoint:${endpointId}`,
      };
      const instance = await store.findByRef({ ref });
      await store.commit({
        ref,
        tenantId: project.id,
        sourceEventId: null,
        expectedRevision: instance?.revision ?? 0,
        state: instance?.state ?? { pending: [] },
        nextWakeAt: instance?.nextWakeAt ?? null,
        messages: [
          {
            messageKey: "send:fabricated-dead",
            intentType: "sendBatch",
            payload: {},
            traceCarrier: {},
          },
        ],
        now: clock,
      });
      const [leased] = (
        await store.leaseDueMessages({
          now: clock + 1,
          limit: 10,
          leaseDurationMs: 1000,
          processNames: [WEBHOOK_DELIVERY_PROCESS_NAME],
        })
      ).filter((m) => m.messageKey === "send:fabricated-dead");
      if (!leased) {
        throw new Error(
          "send:fabricated-dead was not in the leased page; raise the lease limit or drain the buffered messages first",
        );
      }
      await store.markFailed({
        identity: {
          processName: WEBHOOK_DELIVERY_PROCESS_NAME,
          projectId: project.id,
          messageKey: "send:fabricated-dead",
        },
        leaseToken: leased.leaseToken,
        now: clock + 1,
        nextAttemptAt: clock + 1000,
        dead: true,
      });
      const after = await healthService.health({
        organizationId: organization.id,
        endpointId,
      });
      expect(after.dlqDepth).toBe(1);
    } finally {
      await endpoints.update({
        organizationId: organization.id,
        endpointId,
        maxBatchDelayMs: 0,
      });
    }
  });

  /** @scenario Each endpoint retries independently on its own ladder */
  it("a dead endpoint's retries never block the healthy endpoint", async () => {
    const second = await endpoints.create({
      organizationId: organization.id,
      url: "https://receiver-two.example.com/hooks",
      maxBatchDelayMs: 0,
      enabledEvents: ["gateway.request.completed"],
    });
    try {
      sendWebhookMock.mockImplementation(async ({ url }) =>
        url.includes("receiver-two")
          ? { status: 200, body: "ok", eventId: "x" }
          : { status: 503, body: "down", eventId: "x" },
      );
      const requestId = `req-${nanoid(8)}`;
      await consume(admittedEnvelope(requestId));
      await consume(confirmedEnvelope(requestId));
      await drainOutbox(2);

      const healthy = await sendMessagesFor(second.endpoint.id);
      const dead = await sendMessagesFor(endpointId);
      expect(healthy[0]!.status).toBe("dispatched");
      expect(dead[0]!.status).toBe("pending");
    } finally {
      await endpoints.archive({
        organizationId: organization.id,
        endpointId: second.endpoint.id,
      });
    }
  });
});
