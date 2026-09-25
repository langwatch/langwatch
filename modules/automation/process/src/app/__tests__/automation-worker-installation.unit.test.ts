/**
 * @vitest-environment node
 * The automation module installed on the worker role: the pipeline it hosts, over memory.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AutomationServerConfig } from "@langwatch/automation-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { type Mail, memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { automationServer } from "../../automation.server.ts";

const CONFIG: AutomationServerConfig = {
  emailHourlyCap: 100,
  tenantDailyCap: 10_000,
  persistDailyCapFree: 50,
  persistDailyCapPaid: 500,
  persistDailyCapEnterprise: 5_000,
};

function eventingFor(role: "api" | "worker"): EventSourcing {
  const eventStore = EventStoreMemory.createForTesting();
  if (role === "api") {
    return new EventSourcing({
      eventStore,
      executionTarget: "api",
      consumersEnabled: false,
      processManagerMode: "producer-only",
    });
  }
  return new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });
}

function process(role: "api" | "worker", eventing: EventSourcing) {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { NEXTAUTH_SECRET: "session-secret" } }).withEnv(),
  );
  return createApp({ role, secrets: (owner, declared) => resolver.scopeTo(owner, declared) })
    .withModules([withMemoryRepositories(automationServer)])
    .withConfig({ automation: CONFIG })
    .withStores(memoryStores())
    .withEventing(eventing)
    .withKeyvalue(memoryRedisDouble())
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withMember("encryption", {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .withMember("publicBaseUrl", "https://app.langwatch.test")
    .withMember("isSaas", false)
    .withMember("logging", createTestLogger().logger)
    .withMember("mail", createApiFixture<Mail>())
    .provide({
      analytics: createApiFixture<AnalyticsApi>(),
      monitor: createApiFixture<MonitorApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      project: createApiFixture<ProjectApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      trace: createApiFixture<TraceApi>(),
      evaluation: createApiFixture<EvaluationApi>(),
      dataset: createApiFixture<DatasetApi>(),
      annotation: createApiFixture<AnnotationApi>(),
    });
}

async function installedOn(role: "api" | "worker") {
  const eventing = eventingFor(role);
  const runtime = await process(role, eventing).boot();
  await runtime.stop();
  return { keys: [...eventing.globalJobRegistry.keys()], unrun: eventing.unrunProcessManagers };
}

describe("given the automation module installed on the worker role", () => {
  /** @scenario "The worker hosts every automation routing key" */
  it("claims the settlement process manager and the match command", async () => {
    const { keys } = await installedOn("worker");

    expect(keys.toSorted()).toEqual([
      "automations:command:recordTriggerMatch",
      "automations:subscriber:pm:triggerSettlement",
    ]);
  });

  /** @scenario "The worker runs trigger settlement itself" */
  it("leaves no automation process manager unrun", async () => {
    const { unrun } = await installedOn("worker");

    expect(unrun).toEqual([]);
  });
});

describe("given the automation module installed on the api role", () => {
  /** @scenario "The api registers trigger settlement without running it" */
  it("names the settlement process manager among those it will not run", async () => {
    const { unrun } = await installedOn("api");

    expect(unrun).toContain("triggerSettlement");
  });
});
