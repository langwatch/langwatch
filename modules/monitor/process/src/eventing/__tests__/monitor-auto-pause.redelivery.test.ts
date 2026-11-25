import type { AuthzApi } from "@langwatch/authz-contract";
import {
  EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE,
  type EvaluationMonitorErrorRateExceededEventData,
} from "@langwatch/evaluation-contract";
/**
 * @vitest-environment node
 * @unit
 * @see modules/monitor/specs/monitor-auto-pause.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import type { NotificationService, SendEmailCommand } from "@langwatch/notification-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import {
  createMonitorTestApp,
  createMonitorTestRepositories,
} from "../../app/__tests__/monitor.fixture.ts";
import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";

const LANE = "monitor_auto_pause.monitorErrorRateExceeded";
const REVISION = new Date("2026-10-25T09:00:00.000Z");

const FACT: EvaluationMonitorErrorRateExceededEventData = {
  tenantId: "project-1",
  projectId: "project-1",
  monitorId: "monitor-1",
  monitorRevision: REVISION.getTime(),
  occurredAt: REVISION.getTime() + 60_000,
  windowMs: 3_600_000,
  runs: 120,
  errors: 114,
  topError: "Evaluator timed out",
};

function monitorRow(overrides: Partial<MonitorWithEvaluator> = {}): MonitorWithEvaluator {
  return {
    id: "monitor-1",
    projectId: "project-1",
    experimentId: null,
    evaluatorId: "evaluator-1",
    checkType: "langevals/llm_boolean",
    name: "Answer relevancy",
    slug: "answer-relevancy",
    executionMode: "ON_MESSAGE",
    enabled: true,
    preconditions: [],
    parameters: {},
    mappings: { mapping: {}, expansions: [] },
    sample: 1,
    level: "trace",
    threadIdleTimeout: null,
    createdAt: REVISION,
    updatedAt: REVISION,
    evaluator: null,
    ...overrides,
  };
}

function profile(input: {
  id: string;
  email: string | null;
  deactivated?: boolean;
}): UserFullProfile {
  return {
    id: input.id,
    name: input.id,
    email: input.email,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: REVISION,
    updatedAt: REVISION,
    lastLoginAt: null,
    deactivatedAt: input.deactivated ? new Date(0) : null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}

function factEvent({ id = "event-1" }: { id?: string } = {}): Event {
  return {
    id,
    aggregateId: `monitor:${FACT.monitorId}:${FACT.monitorRevision}`,
    aggregateType: "evaluation_lifecycle",
    tenantId: createTenantId(FACT.tenantId),
    createdAt: FACT.occurredAt,
    occurredAt: FACT.occurredAt,
    type: EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE,
    version: "2026-09-30",
    data: FACT,
  };
}

function autoPauseLane({
  seed = [monitorRow()],
  failSends = false,
}: { seed?: MonitorWithEvaluator[]; failSends?: boolean } = {}) {
  const repository = MemoryMonitorRepository.create({ seed });
  const sent: SendEmailCommand[] = [];
  const app = createMonitorTestApp({
    repositories: createMonitorTestRepositories(repository),
    permissions: createApiFixture<AuthzApi>({
      findActiveOrganizationAdministrators: async () => ["admin-1", "admin-2", "admin-3"],
    }),
    projects: createApiFixture<ProjectApi>({
      findSummaryById: async () => ({ name: "Support agent", slug: "support-agent" }),
      findOrganizationId: async () => "organization-1",
    }),
    users: createApiFixture<UserApi>({
      getProfiles: async () => [
        profile({ id: "admin-1", email: "ada@acme.example" }),
        profile({ id: "admin-2", email: "grace@acme.example" }),
        profile({ id: "admin-3", email: "gone@acme.example", deactivated: true }),
      ],
    }),
    notifications: createApiFixture<NotificationService>({
      sendEmail: async (input) => {
        if (failSends) throw new Error("smtp refused");
        sent.push(input);
      },
    }),
  });
  const pipeline = app.autoPausePipeline();
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const definition = lanes.get(LANE);
  if (!definition) throw new Error("no auto-pause lane mounted");
  return { app, definition, repository, sent };
}

const CONTEXT = { tenantId: FACT.tenantId, aggregateId: "monitor:monitor-1" };

describe("monitor's auto-pause peer lane", () => {
  describe("when evaluation reports the error rate exceeded at the monitor's revision", () => {
    /** @scenario "A monitor is paused when its error rate is exceeded" */
    it("disables the monitor and records when and why", async () => {
      const { definition, repository } = autoPauseLane();

      await definition.handle(factEvent(), CONTEXT);

      const monitor = await repository.findById({ id: "monitor-1", projectId: "project-1" });
      expect(definition.eventTypes).toEqual([EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE]);
      expect(monitor?.enabled).toBe(false);
      expect(monitor?.autoPausedAt).toBeInstanceOf(Date);
      expect(monitor?.autoPausedReason).toBe(
        "95% of evaluations failed in the last hour (114 of 120). Most common error: Evaluator timed out",
      );
    });
  });

  describe("when the monitor was edited after the revision the fact names", () => {
    /** @scenario "A report about an older revision of the monitor is ignored" */
    it("keeps the monitor enabled with no reason and sends no email", async () => {
      const { definition, repository, sent } = autoPauseLane({
        seed: [monitorRow({ updatedAt: new Date(REVISION.getTime() + 5_000) })],
      });

      await definition.handle(factEvent(), CONTEXT);

      const monitor = await repository.findById({ id: "monitor-1", projectId: "project-1" });
      expect(monitor?.enabled).toBe(true);
      expect(monitor?.autoPausedReason ?? null).toBeNull();
      expect(sent).toEqual([]);
    });
  });

  describe("when the same fact is delivered twice", () => {
    /** @scenario "The organization's admins are emailed once" */
    it("emails each active admin one message in total", async () => {
      const { definition, sent } = autoPauseLane();

      await definition.handle(factEvent(), CONTEXT);
      await definition.handle(factEvent({ id: "redelivered" }), CONTEXT);

      expect(sent.map(({ to }) => to)).toEqual(["ada@acme.example", "grace@acme.example"]);
      expect(sent[0]?.subject).toBe("Online evaluation paused: Answer relevancy");
      expect(sent[0]?.html).toContain("95%");
      expect(sent[0]?.html).toContain("Evaluator timed out");
      expect(sent[0]?.html).toContain(
        "https://app.langwatch.test/support-agent/online-evaluations?drawer.open=onlineEvaluation&amp;drawer.monitorId=monitor-1",
      );
    });

    /** @scenario "The organization's admins are emailed once" */
    it("queues one job for both deliveries", () => {
      const { definition } = autoPauseLane();
      const deduplication = definition.options?.deduplication;
      if (!deduplication || deduplication === "aggregate") throw new Error("no deduplication id");

      expect(deduplication.makeId(factEvent())).toBe(
        deduplication.makeId(factEvent({ id: "redelivered" })),
      );
    });
  });

  describe("when sending an email fails", () => {
    /** @scenario "A failed email leaves the monitor paused" */
    it("keeps the monitor paused and does not throw", async () => {
      const { definition, repository } = autoPauseLane({ failSends: true });

      await definition.handle(factEvent(), CONTEXT);

      const monitor = await repository.findById({ id: "monitor-1", projectId: "project-1" });
      expect(monitor?.enabled).toBe(false);
    });
  });

  describe("when the user enables a monitor that paused itself", () => {
    /** @scenario "Re-enabling a paused monitor clears the reason" */
    it("no longer records a pause reason or time", async () => {
      const { app, definition, repository } = autoPauseLane();
      await definition.handle(factEvent(), CONTEXT);

      await app.toggle({ id: "monitor-1", projectId: "project-1", enabled: true });

      const monitor = await repository.findById({ id: "monitor-1", projectId: "project-1" });
      expect(monitor?.enabled).toBe(true);
      expect(monitor?.autoPausedAt ?? null).toBeNull();
      expect(monitor?.autoPausedReason ?? null).toBeNull();
    });
  });
});
