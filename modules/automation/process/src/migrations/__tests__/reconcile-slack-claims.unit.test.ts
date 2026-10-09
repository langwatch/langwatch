/**
 * @vitest-environment node
 * Spec: modules/automation/specs/automation.feature (upgrade steps: the Slack claim step)
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
import type {
  SlackApi,
  SlackConnectionClaim,
  SlackConnectionView,
} from "@langwatch/slack-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { isMigrationStep, type MigrationStepReport } from "@langwatch/upgrade/step";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSettlementProjects } from "../../__tests__/fixtures/settlement.fixtures.ts";
import { automationProcessModule } from "../../automation.module.ts";

const PROJECT_ID = "project-1";

const CONFIG: AutomationServerConfig = {
  emailHourlyCap: 100,
  tenantDailyCap: 10_000,
  persistDailyCapFree: 50,
  persistDailyCapPaid: 500,
  persistDailyCapEnterprise: 5_000,
  publicBaseUrl: "https://app.langwatch.test",
};

/** A memory-tier worker hosting automation's pipeline, every peer a fixture but `slack`. */
async function bootWorker({ slack }: { slack: SlackApi }) {
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
      slack,
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
  return { runtime, automations, step };
}

type Worker = Awaited<ReturnType<typeof bootWorker>>;

const STEP = "automation:reconcile-slack-claims";
const CONNECTION = "connection-1";

/** Slack's claims, as slack keeps them: keyed by connection and claimant, paged two at a time. */
class SlackClaims {
  readonly held = new Map<string, SlackConnectionClaim>();

  readonly api = createApiFixture<SlackApi>({
    getUsableSlackConnection: ({ id }) => Promise.resolve(webhookConnection(id)),
    claimConnection: ({ connectionId, projectId, claimant }) => {
      this.held.set(`${connectionId}|${claimant.id}`, { connectionId, projectId, claimant });
      return Promise.resolve();
    },
    releaseConnection: ({ connectionId, claimantId }) => {
      this.held.delete(`${connectionId}|${claimantId}`);
      return Promise.resolve();
    },
    listSlackConnectionClaims: ({ after }) => {
      const all = [...this.held.entries()].toSorted(([left], [right]) => (left < right ? -1 : 1));
      const rest = after === undefined ? all : all.filter(([key]) => key > after);
      const page = rest.slice(0, 2);
      const last = page.at(-1);
      return Promise.resolve({
        claims: page.map(([, claim]) => claim),
        next: last && page.length === 2 ? last[0] : null,
      });
    },
  });

  /** Who holds a claim on each connection, sorted. */
  holders(): string[] {
    return [...this.held.values()]
      .map((claim) => `${claim.connectionId}:${claim.claimant.id}:${claim.claimant.label}`)
      .toSorted();
  }
}

function webhookConnection(id: string): SlackConnectionView {
  return {
    id,
    name: id,
    kind: "INCOMING_WEBHOOK",
    scopeType: "PROJECT",
    scopeId: PROJECT_ID,
    scopeName: "Project",
    secretHint: "abcd",
    slackTeamId: null,
    slackTeamName: null,
    dependentAutomations: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function slackAutomation(id: string, connectionId = CONNECTION) {
  return {
    id,
    projectId: PROJECT_ID,
    name: `Alert ${id}`,
    action: "SEND_SLACK_MESSAGE",
    actionParams: { slackIntegrationId: connectionId, slackDelivery: "webhook" },
    filters: {},
  } satisfies CreateTriggerCommand;
}

/** Runs the step from `resumeFrom`, recording every checkpoint it saves. */
async function runStep({
  worker,
  resumeFrom = null,
  dryRun = false,
}: {
  worker: Worker;
  resumeFrom?: MigrationStepReport | null;
  dryRun?: boolean;
}): Promise<{ report: MigrationStepReport; saves: MigrationStepReport[] }> {
  const saves: MigrationStepReport[] = [];
  const report = await worker.step(STEP).run({
    checkpoint: { resumeFrom, save: async ({ report: saved }) => void saves.push(saved) },
    dryRun,
    signal: new AbortController().signal,
  });
  return { report, saves };
}

let running: Worker | undefined;

async function worker(slack: SlackClaims): Promise<Worker> {
  running = await bootWorker({ slack: slack.api });
  return running;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await running?.runtime.stop();
  running = undefined;
});

describe("given an active Slack automation an older image saved without a claim", () => {
  let slack: SlackClaims;
  let booted: Worker;

  beforeEach(async () => {
    slack = new SlackClaims();
    booted = await worker(slack);
    await booted.automations.create(slackAutomation("older"));
    slack.held.clear();
  });

  /** @scenario "The Slack claim step claims every active Slack automation's connection" */
  it("claims its connection under the automation's name, and a second run claims nothing new", async () => {
    const first = await runStep({ worker: booted });
    const holdersAfterFirst = slack.holders();
    const second = await runStep({ worker: booted });

    expect(booted.step(STEP)).toMatchObject({
      kind: "data",
      mode: "background",
      needsOldWritersGone: true,
    });
    expect(holdersAfterFirst).toEqual([`${CONNECTION}:older:Alert older`]);
    expect(first.report).toEqual({ claimed: 1, skipped: 0, released: 0, kept: 1, dryRun: false });
    expect(slack.holders()).toEqual(holdersAfterFirst);
    expect(second.report).toMatchObject({ released: 0, kept: 1 });
  });

  it("claims and saves nothing on a dry run", async () => {
    const { report, saves } = await runStep({ worker: booted, dryRun: true });

    expect(slack.holders()).toEqual([]);
    expect(saves).toEqual([]);
    expect(report).toMatchObject({ claimed: 1, dryRun: true });
  });
});

describe("given claims still held by a paused and a deleted Slack automation", () => {
  /** @scenario "The Slack claim step releases what no active automation holds" */
  it("releases those claims and keeps the active automation's on the same connection", async () => {
    const slack = new SlackClaims();
    const booted = await worker(slack);
    await booted.automations.create(slackAutomation("active"));
    await booted.automations.create(slackAutomation("paused"));
    await booted.automations.create(slackAutomation("deleted"));
    const stale = new Map(slack.held);
    await booted.automations.update({ id: "paused", projectId: PROJECT_ID, active: false });
    await booted.automations.update({ id: "deleted", projectId: PROJECT_ID, deleted: true });
    for (const [key, claim] of stale) slack.held.set(key, claim);

    const { report } = await runStep({ worker: booted });

    expect(slack.holders()).toEqual([`${CONNECTION}:active:Alert active`]);
    expect(report).toMatchObject({ released: 2, kept: 1 });
  });
});

describe("given a step that stopped after finishing some pages", () => {
  /** @scenario "The Slack claim step resumes after the last page it finished" */
  it("resumes from its checkpoint's cursor and pages the rest", async () => {
    const slack = new SlackClaims();
    const booted = await worker(slack);
    for (const id of ["a", "b", "c", "d"]) {
      await booted.automations.create(slackAutomation(id, `connection-${id}`));
    }
    for (const id of ["a", "b", "c", "d"]) {
      await booted.automations.update({ id, projectId: PROJECT_ID, active: false });
      slack.held.set(`connection-${id}|${id}`, {
        connectionId: `connection-${id}`,
        projectId: PROJECT_ID,
        claimant: { id, label: `Alert ${id}` },
      });
    }
    const { saves } = await runStep({ worker: booted, dryRun: false });
    const afterFirstPage = saves.find(
      (saved) => saved.phase === "release" && typeof saved.after === "string",
    );
    for (const id of ["a", "b", "c", "d"]) {
      slack.held.set(`connection-${id}|${id}`, {
        connectionId: `connection-${id}`,
        projectId: PROJECT_ID,
        claimant: { id, label: `Alert ${id}` },
      });
    }

    const resumed = await runStep({ worker: booted, resumeFrom: afterFirstPage ?? null });

    expect(afterFirstPage).toEqual({ phase: "release", after: "connection-b|b" });
    expect(resumed.report).toMatchObject({ claimed: 0, released: 2 });
    expect(slack.holders()).toEqual(["connection-a:a:Alert a", "connection-b:b:Alert b"]);
  });
});
