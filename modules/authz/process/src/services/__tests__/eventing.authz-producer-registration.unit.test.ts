import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
// Routing keys are cross-process contract; test builds definition through adapter.
import { describe, expect, it, vi } from "vitest";

import { PostgresAuthzAdapter } from "../../app/postgres-authz.build.ts";
import { AUTHZ_GRANT_PIPELINE_NAME } from "../../eventing/authz-grant.pipeline.ts";
import {
  AuthzGrantsCommandDispatcher,
  AuthzCommandDispatcherService,
} from "../authz-grants-command-dispatcher.service.ts";
import type { AuthzGrantsCommandSenders } from "../authz-grants-command-dispatcher.service.ts";

const ORGANIZATION = "organization-1";
const ACTOR = { type: "user", id: "user-1" } as const;
const IDENTITY = { tenantId: ORGANIZATION, organizationId: ORGANIZATION, commandId: "command-1" };

/**
 * One valid payload per command, so every send runs the real schema the
 * consumer will run. A stubbed payload would still enqueue and carry the
 * routing key, hiding a producer whose jobs the consumer would refuse.
 */
const COMMANDS = [
  [
    "attachGrant",
    {
      ...IDENTITY,
      grant: {
        grantId: "rolebinding_1",
        principal: { type: "user", id: "user-1" },
        roleKey: "organization_member",
        scope: { type: "ORGANIZATION", id: ORGANIZATION },
        source: "grants-service",
        actor: ACTOR,
        occurredAtMs: 1,
      },
    },
  ],
  [
    "changeGrantRole",
    {
      ...IDENTITY,
      grantId: "rolebinding_1",
      from: null,
      to: "organization_admin",
      actor: ACTOR,
      occurredAtMs: 1,
    },
  ],
  ["revokeGrant", { ...IDENTITY, grantId: "rolebinding_1", actor: ACTOR, occurredAtMs: 1 }],
  [
    "defineRole",
    {
      ...IDENTITY,
      role: {
        roleId: "role-1",
        name: "Auditor",
        permissions: ["traces:read"],
        kind: "custom",
        occurredAtMs: 1,
      },
      actor: ACTOR,
    },
  ],
  [
    "changeRolePermissions",
    { ...IDENTITY, roleId: "role-1", permissions: ["traces:read"], actor: ACTOR, occurredAtMs: 1 },
  ],
  ["deleteRole", { ...IDENTITY, roleId: "role-1", actor: ACTOR, occurredAtMs: 1 }],
] as const;

class NullDispatcher extends AuthzGrantsCommandDispatcher {
  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    throw new Error("unused");
  }
}

/** Records what a producer enqueued; a producer-only process starts no consumer. */
function recordingQueue() {
  const sent: Record<string, unknown>[] = [];
  const factory = (
    _definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
    async send(payload) {
      sent.push(payload);
    },
    async sendBatch(payloads) {
      sent.push(...payloads);
    },
    async waitUntilReady() {},
    async close() {},
  });
  return { sent, factory };
}

function producerRuntime() {
  const queue = recordingQueue();
  const eventSourcing = new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-api" }),
    queueFactory: queue.factory,
    consumersEnabled: false,
    executionTarget: "api",
  });
  return { queue, eventSourcing };
}

function buildAuthz() {
  return PostgresAuthzAdapter.create({
    database: prismaDouble({ auditLog: { createMany: vi.fn() } }),
    redis: null,
    dispatcher: new NullDispatcher(),
    newBindingId: () => "rolebinding_test",
  }).build();
}

describe("the grants pipeline registered by a producer-only process", () => {
  describe("when the packaged definition is registered without a consumer", () => {
    /** @scenario "The packaged definition registers without a consumer" */
    it("registers a real pipeline rather than the one that drops commands", () => {
      const { eventSourcing } = producerRuntime();

      const registered = eventSourcing.register(buildAuthz().pipeline);

      expect(registered.constructor.name).not.toBe("DisabledPipeline");
      expect(() => AuthzCommandDispatcherService.sendersFrom(registered.commands)).not.toThrow();
    });

    /** @scenario "A produced command carries the consuming process's routing key" */
    it("stamps the routing key the consuming process's registry claims", async () => {
      const { queue, eventSourcing } = producerRuntime();
      const registered = eventSourcing.register(buildAuthz().pipeline);
      const senders = AuthzCommandDispatcherService.sendersFrom(registered.commands);

      for (const [name, payload] of COMMANDS) {
        await senders[name].send(payload as never);
      }

      expect(
        queue.sent.map(
          (job) =>
            `${String(job.__pipelineName)}:${String(job.__jobType)}:${String(job.__jobName)}`,
        ),
      ).toEqual(COMMANDS.map(([name]) => `${AUTHZ_GRANT_PIPELINE_NAME}:command:${name}`));
    });
  });
});
