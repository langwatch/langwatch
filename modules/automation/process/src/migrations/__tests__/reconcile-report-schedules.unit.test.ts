/**
 * @vitest-environment node
 * Spec: modules/automation/specs/automation.feature (upgrade steps)
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  AutomationApi,
  type AutomationServerConfig,
  type CreateTriggerCommand,
} from "@langwatch/automation-contract";
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
import { Temporal, toDate } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { isMigrationStep, type MigrationStepReport } from "@langwatch/upgrade/step";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettlementProjects } from "../../__tests__/fixtures/settlement.fixtures.ts";
import { automationProcessModule } from "../../automation.module.ts";

const FIRST_PASS = "automation:reconcile-report-schedules";
const AFTER_ROLLOUT = "automation:reconcile-report-schedules-after-rollout";
const PROJECT_ID = "project-1";

const CONFIG: AutomationServerConfig = {
  emailHourlyCap: 100,
  tenantDailyCap: 10_000,
  persistDailyCapFree: 50,
  persistDailyCapPaid: 500,
  persistDailyCapEnterprise: 5_000,
  publicBaseUrl: "https://app.langwatch.test",
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
      annotation: createApiFixture<AnnotationApi>(),
      authz: createApiFixture<AuthzApi>(),
      notification: createApiFixture<NotificationService>(),
      slack: createApiFixture<SlackApi>(),
      webhook: createApiFixture<WebhookApi>(),
    })
    .boot();
  const automations = runtime.service(AutomationApi);
  const steps = runtime.migrationSteps(isMigrationStep);
  const step = (id: string) => {
    const found = steps.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`step ${id} is not declared`);
    return found;
  };
  return { runtime, eventStore, automations, step };
}

type Worker = Awaited<ReturnType<typeof bootWorker>>;

/** An active report created as an older image creates it: stored, with no schedule process. */
function report(id: string, actionParams?: CreateTriggerCommand["actionParams"]) {
  return {
    id,
    projectId: PROJECT_ID,
    name: `Report ${id}`,
    triggerKind: "REPORT",
    action: "SEND_EMAIL",
    actionParams: actionParams ?? {
      members: ["ops@acme.test"],
      source: { kind: "dashboard", dashboardId: "dashboard-1" },
      schedule: { cron: "0 9 * * 1", timezone: "UTC" },
      compareToPrevious: false,
    },
    filters: {},
    lastRunAt: toDate(Temporal.Instant.fromEpochMilliseconds(0)),
  } satisfies CreateTriggerCommand;
}

/** Runs a declared step, recording every checkpoint it saves. */
async function runStep({
  worker,
  id,
  dryRun = false,
}: {
  worker: Worker;
  id: string;
  dryRun?: boolean;
}): Promise<{ report: MigrationStepReport; saves: MigrationStepReport[] }> {
  const saves: MigrationStepReport[] = [];
  const result = await worker.step(id).run({
    checkpoint: { resumeFrom: null, save: async ({ report }) => void saves.push(report) },
    dryRun,
    signal: new AbortController().signal,
  });
  return { report: result, saves };
}

async function schedules(worker: Worker) {
  return (await worker.automations.getReportSchedules({ projectId: PROJECT_ID }))
    .map(({ triggerId, active }) => [triggerId, active])
    .toSorted(([left], [right]) => String(left).localeCompare(String(right)));
}

let running: Worker | undefined;

async function worker(): Promise<Worker> {
  running = await bootWorker();
  return running;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await running?.runtime.stop();
  running = undefined;
});

describe("given an active report with no schedule process and a paused one", () => {
  /** @scenario "The first report-schedule step configures every active report that has no schedule" */
  it("configures the missing one once, keeps the paused one paused and reports the count", async () => {
    const booted = await worker();
    await booted.automations.create(report("missing"));
    await booted.automations.create(report("paused"));
    await booted.automations.syncReportSchedule({
      projectId: PROJECT_ID,
      triggerId: "paused",
      cron: "0 9 * * 1",
      timezone: "UTC",
    });
    await booted.automations.removeReportSchedule({ projectId: PROJECT_ID, triggerId: "paused" });
    await vi.waitFor(async () => expect(await schedules(booted)).toEqual([["paused", false]]));

    const { report: outcome } = await runStep({ worker: booted, id: FIRST_PASS });

    expect(booted.step(FIRST_PASS)).toMatchObject({ kind: "data", mode: "background" });
    expect(booted.step(FIRST_PASS).needsOldWritersGone).not.toBe(true);
    expect(outcome).toEqual({ repaired: 1 });
    await vi.waitFor(async () =>
      expect(await schedules(booted)).toEqual([
        ["missing", true],
        ["paused", false],
      ]),
    );
  });
});

describe("given a report an older image created during the rollout", () => {
  /** @scenario "The report-schedule twin runs after older images stop serving" */
  it("declares the twin as waiting for old writers and configures the report once", async () => {
    const booted = await worker();
    await booted.automations.create(report("rollout"));

    const { report: outcome } = await runStep({ worker: booted, id: AFTER_ROLLOUT });

    expect(booted.step(AFTER_ROLLOUT)).toMatchObject({
      kind: "data",
      mode: "background",
      needsOldWritersGone: true,
    });
    expect(outcome).toEqual({ repaired: 1 });
    await vi.waitFor(async () => expect(await schedules(booted)).toEqual([["rollout", true]]));
  });

  /** @scenario "Running a report-schedule step twice repairs nothing the second time" */
  it("repairs nothing on a second run and appends no schedule command", async () => {
    const booted = await worker();
    await booted.automations.create(report("rollout"));
    await runStep({ worker: booted, id: FIRST_PASS });
    await vi.waitFor(async () => expect(await schedules(booted)).toEqual([["rollout", true]]));
    const appended = vi.spyOn(booted.eventStore, "storeEvents");

    const { report: outcome } = await runStep({ worker: booted, id: AFTER_ROLLOUT });

    expect(outcome).toEqual({ repaired: 0 });
    expect(appended).not.toHaveBeenCalled();
  });

  /** @scenario "A report-schedule step's dry run sends no command" */
  it("reports a dry run, appends no command and saves no checkpoint", async () => {
    const booted = await worker();
    await booted.automations.create(report("rollout"));
    const appended = vi.spyOn(booted.eventStore, "storeEvents");

    const { report: outcome, saves } = await runStep({
      worker: booted,
      id: FIRST_PASS,
      dryRun: true,
    });

    expect(outcome).toEqual({ dryRun: true });
    expect(saves).toEqual([]);
    expect(appended).not.toHaveBeenCalled();
    expect(await schedules(booted)).toEqual([]);
  });

  /** @scenario "A report-schedule step that fails to configure a report fails by name" */
  it("fails with the refusal and configures the still-missing report on the next run", async () => {
    const booted = await worker();
    await booted.automations.create(report("rollout"));
    const refusal = Object.assign(new Error("event store unavailable"), { code: "store_down" });
    vi.spyOn(booted.eventStore, "storeEvents").mockRejectedValueOnce(refusal);

    await expect(runStep({ worker: booted, id: FIRST_PASS })).rejects.toMatchObject({
      code: "store_down",
    });
    const { report: outcome } = await runStep({ worker: booted, id: FIRST_PASS });

    expect(outcome).toEqual({ repaired: 1 });
    await vi.waitFor(async () => expect(await schedules(booted)).toEqual([["rollout", true]]));
  });
});

describe("given an active report whose stored parameters carry no schedule", () => {
  /** @scenario "A report trigger whose parameters are not a report is skipped" */
  it("sends no schedule command for it and does not fail", async () => {
    const booted = await worker();
    await booted.automations.create(report("unscheduled", { members: ["ops@acme.test"] }));
    const appended = vi.spyOn(booted.eventStore, "storeEvents");

    const { report: outcome } = await runStep({ worker: booted, id: FIRST_PASS });

    expect(outcome).toEqual({ repaired: 0 });
    expect(appended).not.toHaveBeenCalled();
  });
});
