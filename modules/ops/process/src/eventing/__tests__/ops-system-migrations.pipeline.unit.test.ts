import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
/** Spec: specs/migration/system-migrations-runner.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { opsServer } from "../../ops.server.ts";
import type { SystemMigrationsServiceDependencies } from "../../rules/system-migration-support.rules.ts";
import { SystemMigrationPassRequestsService } from "../../services/system-migration-pass-requests.service.ts";
import { SystemMigrationsService } from "../../services/system-migrations.service.ts";
import { SYSTEM_MIGRATION_PASS_PROCESS_NAME } from "../ops-system-migrations.intent.ts";
import {
  SYSTEM_MIGRATIONS_PIPELINE_NAME,
  buildSystemMigrations,
  systemMigrationsEventing,
} from "../ops-system-migrations.pipeline.ts";
import {
  systemMigrationPassRequested,
  systemMigrationRedriveWake,
} from "../ops-system-migrations.process.ts";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const HOUR = 60 * 60_000;

const PASS: MigrationPassSummary = {
  tenantsSeen: 1,
  finalized: 0,
  held: 0,
  parked: 1,
  skipped: 0,
  alreadyFinalized: 0,
  alreadyRolledBack: 0,
  claimed: 0,
  advanced: 0,
};

const intent = intentAccessorOf({
  runPass: (messageKey, payload) => ({ messageKey, intentType: "runPass", payload }),
});

/** The console over only the two pass collaborators these scenarios reach. */
function passes(deps: Partial<SystemMigrationsServiceDependencies>) {
  return SystemMigrationsService.create(
    createApiFixture<SystemMigrationsServiceDependencies>(deps, "system migration deps"),
  );
}

function built(executeSystemMigrationPass: (input: { redrive: boolean }) => Promise<void>) {
  const definition = buildSystemMigrations({
    participation: "consume",
    repositories: undefined,
    app: { executeSystemMigrationPass },
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const process = definition.processManagers.get(SYSTEM_MIGRATION_PASS_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no system-migration process manager");
  return { definition, process };
}

async function deliver(process: ReturnType<typeof built>["process"], redrive: boolean) {
  await process.config.intents!.runPass!.run(
    { redrive, requestedAt: NOW },
    {
      processName: SYSTEM_MIGRATION_PASS_PROCESS_NAME,
      projectId: "__global__",
      processKey: SYSTEM_MIGRATION_PASS_PROCESS_NAME,
      tenantId: "__global__",
      messageKey: `redrive:${NOW}`,
      attempt: 1,
    },
  );
}

/** A real producer-only runtime recording what the api would enqueue. */
function producer() {
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
  const eventing = new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-test" }),
    queueFactory: factory,
    consumersEnabled: false,
    executionTarget: "api",
    processManagerMode: "producer-only",
  });
  return { eventing, sent };
}

describe("given ops's system-migrations declaration", () => {
  /** @scenario "The hourly re-drive runs as a scheduled process once across the fleet" */
  it("is installed with the module and wakes its singleton hourly", () => {
    const { definition, process } = built(async () => undefined);

    expect(systemMigrationsEventing.pipeline).toBe(SYSTEM_MIGRATIONS_PIPELINE_NAME);
    expect(opsServer.eventing?.pipeline.split(", ")).toContain(SYSTEM_MIGRATIONS_PIPELINE_NAME);
    expect(definition.metadata.name).toBe(SYSTEM_MIGRATIONS_PIPELINE_NAME);
    expect(process.config.schedule?.everyMs).toBe(HOUR);
  });

  /** @scenario "The hourly re-drive runs as a scheduled process once across the fleet" */
  it("asks for one gated pass per wake, keyed by the wake", () => {
    const wake = (at: number) =>
      systemMigrationRedriveWake(
        { lastRequestedAt: null },
        { at, now: at, key: SYSTEM_MIGRATION_PASS_PROCESS_NAME, projectId: "__global__", intent },
      );

    expect(wake(NOW).intents).toEqual([
      {
        messageKey: `redrive:${NOW}`,
        intentType: "runPass",
        payload: { redrive: true, requestedAt: NOW },
      },
    ]);
    expect(wake(NOW + HOUR).intents?.[0]?.messageKey).not.toBe(wake(NOW).intents?.[0]?.messageKey);
  });

  describe("when the re-drive comes round with a tenant parked after startup", () => {
    /** @scenario "A worker re-drives a parked tenant without being asked" */
    it("runs a pass that attempts the tenant again, and again on the next wake", async () => {
      const runPass = vi.fn(async () => PASS);
      const service = passes({ hasTenantAwaitingRedrive: async () => true, runPass });
      const { process } = built((input) => service.executePass(input));

      await deliver(process, true);
      await deliver(process, true);

      expect(runPass).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the re-drive comes round with a held tenant under recurring reconciliation", () => {
    /** @scenario "A recurring reconciliation keeps running on a long-lived worker" */
    it("re-proves it, because a held tenant is still one a pass can move", async () => {
      const runPass = vi.fn(async () => ({ ...PASS, parked: 0, held: 1, finiteHeld: 0 }));
      const service = passes({ hasTenantAwaitingRedrive: async () => true, runPass });

      await deliver(built((input) => service.executePass(input)).process, true);

      expect(runPass).toHaveBeenCalledOnce();
    });
  });

  describe("when the re-drive comes round with every tenant latched", () => {
    /** @scenario "A fleet with nothing to re-drive does not sweep" */
    it("asks the stored state and runs no pass", async () => {
      const hasTenantAwaitingRedrive = vi.fn(async () => false);
      const service = passes({ hasTenantAwaitingRedrive });

      await deliver(built((input) => service.executePass(input)).process, true);

      expect(hasTenantAwaitingRedrive).toHaveBeenCalledOnce();
    });
  });

  describe("when a re-drive's pass fails outright", () => {
    /** @scenario "A re-drive that fails does not end the cadence" */
    it("settles the intent and attempts another pass on the next wake", async () => {
      const runPass = vi
        .fn<() => Promise<MigrationPassSummary>>()
        .mockRejectedValueOnce(new Error("state table unavailable"))
        .mockResolvedValue(PASS);
      const service = passes({ hasTenantAwaitingRedrive: async () => true, runPass });
      const { process } = built((input) => service.executePass(input));

      await expect(deliver(process, true)).resolves.toBeUndefined();
      await deliver(process, true);

      expect(runPass).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a process does not run the worker stack", () => {
    /** @scenario "Only a worker re-drives" */
    it("registers the pipeline to send, and runs no process manager of its own", () => {
      const { eventing } = producer();

      const registered = eventing.register(built(async () => undefined).definition);

      expect(Object.keys(registered.commands)).toEqual(["requestSystemMigrationPass"]);
      expect(() => eventing.processRuntime).toThrow(/producer-only/);
    });
  });

  describe("when an operator kicks a pass from the page", () => {
    /** @scenario "Kicking a pass from the page runs one pass on a worker" */
    it("sends the request as the operator, and the worker's handler asks for one ungated pass", async () => {
      const { eventing, sent } = producer();
      const requests = SystemMigrationPassRequestsService.create();
      requests.connect(
        eventing.register(built(async () => undefined).definition).commands
          .requestSystemMigrationPass,
      );

      await requests.request({ actorUserId: "user_operator" });
      const asked = systemMigrationPassRequested(
        { lastRequestedAt: null },
        {},
        {
          at: NOW,
          now: NOW,
          key: "system_migration_pass_requests",
          projectId: "user_operator",
          intent,
        },
      );

      expect(sent).toEqual([expect.objectContaining({ tenantId: "user_operator" })]);
      expect(asked.intents).toEqual([
        {
          messageKey: `operator:user_operator:${NOW}`,
          intentType: "runPass",
          payload: { redrive: false, requestedAt: NOW },
        },
      ]);
    });

    /** @scenario "Kicking a pass from the page runs one pass on a worker" */
    it("runs the pass without asking the stored state first", async () => {
      const runPass = vi.fn(async () => PASS);
      const service = passes({ runPass });

      await deliver(built((input) => service.executePass(input)).process, false);

      expect(runPass).toHaveBeenCalledOnce();
    });
  });

  describe("when the kick cannot be sent", () => {
    /** @scenario "A kick in a process that never connected the pass command still answers started" */
    it("resolves without sending anything", async () => {
      const requests = SystemMigrationPassRequestsService.create();

      await expect(requests.request({ actorUserId: "user_operator" })).resolves.toBeUndefined();
    });

    /** @scenario "A kick whose send fails still answers started" */
    it("resolves after the sender refused", async () => {
      const requests = SystemMigrationPassRequestsService.create();
      const send = vi.fn(() => Promise.reject(new Error("event store unavailable")));
      requests.connect({ send });

      await expect(requests.request({ actorUserId: "user_operator" })).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledOnce();
    });
  });
});
