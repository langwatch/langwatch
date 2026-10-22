/**
 * @vitest-environment node
 * Spec: modules/automation/specs/automation.feature (the JSON-text step). The step's behaviour
 * over rows is in services/__tests__/trigger-json-text-unwrap.service.unit.test.ts.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { AutomationServerConfig } from "@langwatch/automation-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type { SlackApi } from "@langwatch/slack-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import {
  isDeclaredMigrationStep,
  isMigrationStep,
  type MigrationStepReport,
} from "@langwatch/upgrade/step";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { afterEach, describe, expect, it } from "vitest";

import { createSettlementProjects } from "../../__tests__/fixtures/settlement.fixtures.ts";
import { automationProcessModule } from "../../automation.module.ts";

const STEP = "automation:unwrap-trigger-json-text";

const CONFIG: AutomationServerConfig = {
  emailHourlyCap: 100,
  tenantDailyCap: 10_000,
  persistDailyCapFree: 50,
  persistDailyCapPaid: 500,
  persistDailyCapEnterprise: 5_000,
  publicBaseUrl: "https://app.langwatch.test",
  slackApiBase: "https://slack.com/api",
  slackWebhookBase: "https://hooks.slack.com",
  allowInsecureLocalUrls: false,
};

/** A memory-tier worker hosting automation's pipeline, every peer a fixture. */
async function bootWorker() {
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { NEXTAUTH_SECRET: "session-secret" } }).withEnv(),
  );
  const runtime = await createApp({
    role: "worker",
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
  })
    .withModules([automationProcessModule])
    .withConfig({ automation: CONFIG })
    .withStores(memoryStores())
    .withEventing(eventing)
    .provide({
      analytics: createApiFixture<AnalyticsApi>(),
      monitor: createApiFixture<MonitorApi>(),
      evaluator: createApiFixture<EvaluatorApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      project: createSettlementProjects(),
      "audit-log": createApiFixture<AuditLogApi>(),
      trace: createApiFixture<TraceApi>(),
      evaluation: createApiFixture<EvaluationApi>(),
      dataset: createApiFixture<DatasetApi>(),
      "data-retention": createApiFixture<DataRetentionApi>(),
      annotation: createApiFixture<AnnotationApi>(),
      authz: createApiFixture<AuthzApi>(),
      notification: createApiFixture<NotificationService>(),
      slack: createApiFixture<SlackApi>(),
      webhook: createApiFixture<WebhookApi>(),
    })
    .boot();
  const steps = runtime.migrationSteps(isDeclaredMigrationStep).filter(isMigrationStep);
  const step = (id: string) => {
    const found = steps.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`step ${id} is not declared`);
    return found;
  };
  return { runtime, step };
}

let running: Awaited<ReturnType<typeof bootWorker>> | undefined;

afterEach(async () => {
  await running?.runtime.stop();
  running = undefined;
});

/** Runs the step from the start, recording every checkpoint it saves. */
async function runStep({ dryRun }: { dryRun: boolean }) {
  running = await bootWorker();
  const saves: MigrationStepReport[] = [];
  const report = await running.step(STEP).run({
    checkpoint: { resumeFrom: null, save: async ({ report: saved }) => void saves.push(saved) },
    dryRun,
    signal: new AbortController().signal,
  });
  return { step: running.step(STEP), report, saves };
}

describe("the trigger JSON-text step", () => {
  it("is a background data step that waits for older images to stop serving", async () => {
    const { step } = await runStep({ dryRun: true });

    expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });
    expect(step.description).toMatch(/JSON text/);
  });

  it("reports nothing to do and saves no checkpoint where no trigger holds JSON text", async () => {
    const { report, saves } = await runStep({ dryRun: false });

    expect(report).toEqual({
      unwrapped: 0,
      leftAlone: 0,
      changed: 0,
      unparseable: 0,
      dryRun: false,
    });
    expect(saves).toEqual([]);
  });
});
