// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The delivery process manager end to end against real Postgres: spend
 * pipeline events consumed through the transactional inbox, the deliver
 * fan-out committing per-endpoint send messages, and the send executor
 * recording the receiver's answers. The HTTP sender is mocked; the
 * definition under test is the EXACT one the runtime mounts, built through
 * the pipeline's own applier.
 */

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
import type { Organization, Project, Team } from "@prisma/client";
import { prisma } from "~/server/db";
import {
  InMemoryProcessStore,
  ProcessManagerService,
  type ProcessDefinition,
} from "~/server/event-sourcing/process-manager";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager/outbox/outboxDispatcherService";
import type { ProcessEventEnvelope } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { WebhookEndpointService } from "../webhookEndpoint.service";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  webhookDeliveryPM,
  type WebhookDeliveryProcessDeps,
  type WebhookDeliveryState,
} from "../process-manager/webhookDelivery.process";

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

function envelopeFor(
  requestId: string,
  eventType: string,
  data: Record<string, unknown>,
  occurredAt: number,
): ProcessEventEnvelope {
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
  return envelopeFor(
    requestId,
    GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
    {
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
    T0,
  );
}

function confirmedEnvelope(requestId: string): ProcessEventEnvelope {
  return envelopeFor(
    requestId,
    GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    {
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
    T0 + 3000,
  );
}

function failedEnvelope(requestId: string): ProcessEventEnvelope {
  return envelopeFor(
    requestId,
    GATEWAY_SPEND_FAILED_EVENT_TYPE,
    {
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
    T0 + 1500,
  );
}

async function consume(envelope: ProcessEventEnvelope): Promise<void> {
  const result = await service.handleEvent({ envelope, now: clock });
  expect(result.outcome).not.toBe("revisionConflict");
}

async function drainOutbox(passes = 6): Promise<void> {
  for (let i = 0; i < passes; i++) {
    clock += 1000;
    await dispatcher.runOnce({ now: clock, limit: 50 });
  }
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
    prisma,
    processStore: store,
    endpoints,
    getPlan: async () =>
      ({ webhookEndpoints: true }) as Awaited<
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
    expect(body.batch[0]!.id).toBe(requestId);
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

  /** @scenario Failed and settled requests are delivered with their own statuses */
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

    const deliveries = await endpoints.listDeliveries({
      organizationId: organization.id,
      endpointId,
    });
    const row = deliveries.find((d) => d.dispatchId.includes(requestId));
    expect(row).toMatchObject({ outcome: "retryable", responseStatus: 503 });
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

  /** @scenario Each endpoint retries independently on its own ladder */
  it("a dead endpoint's retries never block the healthy endpoint", async () => {
    const second = await endpoints.create({
      organizationId: organization.id,
      url: "https://receiver-two.example.com/hooks",
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
