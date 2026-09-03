/**
 * Spec: packages/features/authz/specs/grants-command-dispatch.feature
 *
 * The grants pipeline registered by a process that only PRODUCES commands.
 *
 * The routing keys asserted here are the whole cross-process contract: the
 * consumer routes on the `pipeline:jobType:jobName` triple a producer stamps
 * (`apps/worker/src/features/job-registry.json` claims `authz_grant` and
 * `command:<name>`), and a job whose triple it does not hold is rejected and
 * redelivered rather than run.
 *
 * The keys cannot drift, because both sides register the SAME packaged
 * definition and the triple is derived from its names — which is exactly why
 * this test builds the definition through `PostgresAuthzAdapter` rather than
 * restating it. What it pins is that a registration with no consumer still
 * produces those keys.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import { AuthzGrantsCommandDispatcher } from "../../ports/authz-grants-command-dispatcher.port";
import type { AuthzGrantsCommandSenders } from "../../ports/authz-grants-command-dispatcher.port";
import type { PostgresAuthzDatabase } from "../../ports/postgres-authz-database.port";
import { PostgresAuthzAdapter } from "../postgres.authz.adapter";
import { EventingAuthzCommandDispatcherAdapter } from "../eventing.authz-command-dispatcher.adapter";
import { AUTHZ_GRANT_PIPELINE_NAME } from "../eventing.authz.adapter";

const ORGANIZATION = "organization-1";
const ACTOR = { type: "user", id: "user-1" } as const;
const IDENTITY = { tenantId: ORGANIZATION, organizationId: ORGANIZATION, commandId: "command-1" };

/**
 * One valid payload per command, so every send runs the real schema the
 * consumer will run. A stubbed payload would still be enqueued and would still
 * carry the routing key, which is exactly the assertion this file makes — so
 * the payloads have to be genuine or the test would pass over a producer that
 * enqueues jobs the consumer refuses.
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
    database: { auditLog: { createMany: vi.fn() } } as unknown as PostgresAuthzDatabase,
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
      expect(() =>
        EventingAuthzCommandDispatcherAdapter.sendersFrom(registered.commands),
      ).not.toThrow();
    });

    /** @scenario "A produced command carries the consuming process's routing key" */
    it("stamps the routing key the consuming process's registry claims", async () => {
      const { queue, eventSourcing } = producerRuntime();
      const registered = eventSourcing.register(buildAuthz().pipeline);
      const senders = EventingAuthzCommandDispatcherAdapter.sendersFrom(registered.commands);

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
