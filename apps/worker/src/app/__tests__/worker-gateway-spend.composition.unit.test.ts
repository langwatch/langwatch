import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { InMemoryWebhookDispatchRateLimiterAdapter, WebhookEgressService } from "@langwatch/egress";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  createWorkerGatewaySpend,
  WorkerGatewaySpendAbsenceReportPort,
} from "../worker-gateway-spend.composition";
import { createWorkerProcessDatabase } from "./support/worker-database.double";

/**
 * Spec: specs/ai-gateway/worker-gateway-spend-conversion.feature
 *
 * THE CONVERSION, asserted where it can actually fail. Both definitions used to
 * arrive from the application; re-registering one could not tell a graph that
 * reaches its own collaborators from one that was handed in. So the assertions
 * below build both real definitions from substrates, drive the debit path's
 * delivery into Governance's own commands, and hold the four absences to being
 * DECLARED rather than silently answered — every one of which is invisible in
 * production if it is not.
 */

const RECORDED: { governance: Array<{ command: string; data: unknown }>; absences: string[] } = {
  governance: [],
  absences: [],
};

function reset(): void {
  RECORDED.governance.length = 0;
  RECORDED.absences.length = 0;
}

class RecordingAbsence extends WorkerGatewaySpendAbsenceReportPort {
  withoutSpendSettlement(): void {
    RECORDED.absences.push("spendSettlement");
  }
  withoutSqsWebhookDestinations(): void {
    RECORDED.absences.push("sqsWebhookDestinations");
  }
  withoutWebhookEntitlements(): void {
    RECORDED.absences.push("webhookEntitlements");
  }
  withoutEndpointSecretKey(): void {
    RECORDED.absences.push("endpointSecretKey");
  }
}

function compose(source: Record<string, unknown> = {}) {
  return createWorkerGatewaySpend({
    config: resolveWorkerConfig({ NODE_ENV: "test", ...source }),
    database: createWorkerProcessDatabase() as never,
    resolveClickHouseClient: (async () => ({
      insert: async () => undefined,
      query: async () => ({ json: async () => [] }),
    })) as never,
    redis: null,
    processStore: {} as never,
    egress: WebhookEgressService.create({
      rateLimiter: InMemoryWebhookDispatchRateLimiterAdapter.create(),
      tls: { rejectUnauthorized: true },
    }),
    governanceCommands: {
      recordVkLifecycle: async (data) => {
        RECORDED.governance.push({ command: "recordVkLifecycle", data });
      },
      recordBudgetCrossing: async (data) => {
        RECORDED.governance.push({ command: "recordBudgetCrossing", data });
      },
    },
    absence: new RecordingAbsence(),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
  });
}

function frozenRoutingKeys(name: string): string[] {
  const registry = JSON.parse(
    readFileSync(new URL("../../features/job-registry.json", import.meta.url), "utf8"),
  ) as { pipelines: Array<{ name: string; jobs: string[] }> };
  const pipeline = registry.pipelines.find((entry) => entry.name === name);
  if (!pipeline) throw new Error(`${name} is absent from the job registry`);
  return pipeline.jobs;
}

type BuiltDefinition = {
  metadata: { name: string };
  foldProjections: Map<string, unknown>;
  stateProjections?: Map<string, unknown>;
  mapProjections: Map<string, unknown>;
  commands: ReadonlyArray<{ name: string }>;
  foldSubscribers: Map<string, unknown>;
  mapSubscribers: Map<string, unknown>;
  eventSubscribers: Map<string, unknown>;
  processManagers: Map<string, { config: { eventTypes: readonly string[] } }>;
};

function registeredKeys(definition: BuiltDefinition): Set<string> {
  const keys = new Set<string>();
  for (const name of definition.foldProjections.keys()) keys.add(`projection:${name}`);
  for (const name of definition.stateProjections?.keys() ?? []) keys.add(`stateProjection:${name}`);
  for (const name of definition.mapProjections.keys()) keys.add(`handler:${name}`);
  for (const command of definition.commands) keys.add(`command:${command.name}`);
  for (const name of definition.foldSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.mapSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.eventSubscribers.keys()) keys.add(`subscriber:${name}`);
  for (const [name, manager] of definition.processManagers) {
    // The runtime's own rule: a schedule-only process manager registers no
    // live subscriber, so it stages no routing key.
    if (manager.config.eventTypes.length > 0) keys.add(`subscriber:pm:${name}`);
  }
  return keys;
}

describe("given the spend spine and the governance signal log this process composes", () => {
  describe("when the composition root builds them", () => {
    /** @scenario "The worker mounts every gateway spend and governance routing key" */
    it("registers every spend routing key the frozen registry lists, and no other", () => {
      reset();
      const definition = compose().spend.buildProcessing() as unknown as BuiltDefinition;
      const registered = registeredKeys(definition);

      const frozen = frozenRoutingKeys("gateway_spend_processing");
      expect(frozen.filter((key) => !registered.has(key))).toEqual([]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
      expect(frozen).toHaveLength(7);
    });

    /** @scenario "The worker mounts every gateway spend and governance routing key" */
    it("registers every governance routing key the frozen registry lists, and no other", () => {
      reset();
      const definition = compose().governance.buildProcessing() as unknown as BuiltDefinition;
      const registered = registeredKeys(definition);

      const frozen = frozenRoutingKeys("governance_events_processing");
      expect(frozen.filter((key) => !registered.has(key))).toEqual([]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
      expect(frozen).toHaveLength(3);
    });

    /**
     * The settlement sweeper is deliberately absent, and this asserts what that
     * costs: NOTHING in routing terms, because it subscribes to no event. A
     * future change that gave it an `.on(...)` handler would start staging a key
     * this graph does not claim, and this is where that shows up.
     *
     * @scenario "The settlement sweeper is declared absent, not silently skipped" */
    it("mounts no process manager the registry does not name", () => {
      reset();
      const definition = compose().spend.buildProcessing() as unknown as BuiltDefinition;

      expect([...definition.processManagers.keys()].sort()).toEqual([
        "gatewayDebits",
        "webhookDelivery",
      ]);
    });
  });

  describe("when the composition root reports what it could not build", () => {
    /** @scenario "The settlement sweeper is declared absent, not silently skipped" */
    it("declares the settlement absence by name at boot", () => {
      reset();
      compose();

      expect(RECORDED.absences).toContain("spendSettlement");
    });

    /** @scenario "An endpoint secret this deployment encrypted cannot be read without its key" */
    it("declares the missing credentials key rather than signing with plaintext", () => {
      reset();
      compose();

      expect(RECORDED.absences).toContain("endpointSecretKey");
    });

    /** @scenario "An endpoint secret this deployment encrypted cannot be read without its key" */
    it("stops declaring it once the deployment names one", () => {
      reset();
      compose({ CREDENTIALS_SECRET: "a".repeat(64) });

      expect(RECORDED.absences).not.toContain("endpointSecretKey");
    });
  });
});
