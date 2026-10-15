import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
// Routing keys are cross-process contract; test builds definition through the module.
import { describe, expect, it } from "vitest";

import { AuthzModule, type AuthzSetup } from "../../app/authz.app.ts";
import { AUTHZ_GRANT_PIPELINE_NAME } from "../../eventing/authz-grant.pipeline.ts";
import { MemoryAuthzRepositories } from "../../repositories/memory/memory.authz.repositories.ts";
import { AuthzCommandDispatcherService } from "../authz-grants-command-dispatcher.service.ts";

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
  const app = AuthzModule.create({
    dependencies: {},
    config: {
      epochCacheEnabled: false,
      demoProjectId: undefined,
      demoProjectUserId: undefined,
      demoProjectSlug: undefined,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<AuthzSetup["secrets"]>(),
    repositories: MemoryAuthzRepositories.create(),
  });
  return { pipeline: app.eventingPipeline() };
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

    /** @scenario "The API process registers the packaged grants pipeline, not a copy" */
    it("registers the packaged pipeline once and refuses a second registration of it", () => {
      const { eventSourcing } = producerRuntime();

      const registered = eventSourcing.register(buildAuthz().pipeline);

      expect(registered.metadata.name).toBe(AUTHZ_GRANT_PIPELINE_NAME);
      expect(registered.constructor.name).not.toBe("DisabledPipeline");
      expect(() => eventSourcing.register(buildAuthz().pipeline)).toThrow(/already registered/);
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
