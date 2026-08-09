/**
 * Containment decides whether a busy automation is throttled or stopped, and
 * getting that wrong in either direction is expensive: pausing a legitimate
 * automation breaks a customer's pipeline, and not pausing a misconfigured one
 * is the incident that produced this work. These run against real trigger rows
 * because "stays active" and "is paused with a reason" are claims about what is
 * actually in the database, not about what a mock was called with.
 */
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { register } from "prom-client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "~/server/db";

// Registers the counters the metric assertions read back.
import "~/server/metrics";

import { PrismaTriggerRepository } from "../repositories/trigger.prisma.repository";
import type { TriggerSummary } from "../repositories/trigger.repository";
import {
  handlePersistCapBreach,
  RUNAWAY_PAUSE_REASON,
  type RunawayContainmentDeps,
} from "../runaway-containment.service";
import { TriggerService } from "../trigger.service";

describe("Feature: runaway automation containment", () => {
  const ns = `runaway-${nanoid(8)}`;

  let organization: Organization;
  let team: Team;
  let project: Project;
  let triggers: TriggerService;

  let projectTraces24h = 10_000;
  let sentEmails: Array<{ kind: string; skippedToday: number }>;
  let claimed: Set<string>;

  function deps(): RunawayContainmentDeps {
    return {
      countProjectTraces24h: async () => projectTraces24h,
      pauseTrigger: async ({ triggerId, projectId, reason, at }) => {
        await triggers.update({
          triggerId,
          projectId,
          data: { active: false, pausedReason: reason, pausedAt: at },
        });
        await triggers.invalidate(projectId);
      },
      notificationRecipients: async () => ["admin@example.com"],
      sendLimitEmail: async ({ kind, skippedToday }) => {
        sentEmails.push({ kind, skippedToday });
      },
      // A real SET-NX has the same shape: true only for the first claimant.
      claimOnce: async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      projectName: async () => "Test project",
      automationUrl: async () => "https://app.example.test/automations",
    };
  }

  async function storeTrigger(
    overrides: { filters?: string; filterQuery?: string | null } = {},
  ) {
    return prisma.trigger.create({
      data: {
        id: nanoid(),
        name: `Automation ${nanoid(4)}`,
        projectId: project.id,
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: {},
        filters:
          overrides.filters ?? JSON.stringify({ "metadata.labels": ["prod"] }),
        filterQuery: overrides.filterQuery ?? null,
        triggerKind: TriggerKind.AUTOMATION,
      },
    });
  }

  function summary(
    row: { id: string; name: string },
    overrides: Partial<TriggerSummary> = {},
  ): TriggerSummary {
    return {
      id: row.id,
      projectId: project.id,
      name: row.name,
      action: TriggerAction.ADD_TO_DATASET,
      triggerKind: TriggerKind.AUTOMATION,
      actionParams: {},
      filters: { "metadata.labels": ["prod"] },
      filterQuery: null,
      alertType: null,
      message: null,
      customGraphId: null,
      notificationCadence: "immediate",
      traceDebounceMs: 30_000,
      templates: {
        slackTemplateType: null,
        slackTemplate: null,
        emailSubjectTemplate: null,
        emailBodyTemplate: null,
      },
      ...overrides,
    };
  }

  const breach = (trigger: TriggerSummary, count: number) => ({
    trigger,
    projectId: project.id,
    count,
    cap: 100,
    skipped: count - 100,
  });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Runaway Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Runaway Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Runaway Project",
        slug: `--test-project-${ns}`,
        teamId: team.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
    triggers = new TriggerService(new PrismaTriggerRepository(prisma));
  });

  beforeEach(() => {
    projectTraces24h = 10_000;
    sentEmails = [];
    claimed = new Set();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (!organization?.id) return;
    await prisma.trigger.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  describe("when a selective automation passes its ceiling", () => {
    /** @scenario "A throttled automation stays active" */
    it("leaves it running so it dispatches again tomorrow", async () => {
      const row = await storeTrigger();

      await handlePersistCapBreach(deps(), breach(summary(row), 150));

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: project.id },
      });
      expect(after.active).toBe(true);
      expect(after.pausedReason).toBeNull();
    });

    /** @scenario "A busy but selective automation is never paused" */
    it("sends no pause email when its matches are a small share of traffic", async () => {
      const row = await storeTrigger();
      projectTraces24h = 10_000;

      await handlePersistCapBreach(deps(), breach(summary(row), 150));

      expect(sentEmails.map((email) => email.kind)).toEqual([
        "ceiling_reached",
      ]);
    });

    /** @scenario "The customer is emailed once on the first day a trigger breaches" */
    it("emails once however many matches breach that day", async () => {
      const row = await storeTrigger();
      const sharedDeps = deps();

      await handlePersistCapBreach(sharedDeps, breach(summary(row), 101));
      await handlePersistCapBreach(sharedDeps, breach(summary(row), 102));
      await handlePersistCapBreach(sharedDeps, breach(summary(row), 500));

      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]).toMatchObject({ kind: "ceiling_reached" });
    });
  });

  describe("when the automation is matching essentially all of the project", () => {
    /** @scenario "An automation matching nearly all traffic is paused" */
    it("pauses it with a runaway reason and tells the customer", async () => {
      const row = await storeTrigger();
      projectTraces24h = 1_000;

      await handlePersistCapBreach(deps(), breach(summary(row), 990));

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: project.id },
      });
      expect(after.active).toBe(false);
      expect(after.pausedReason).toBe(RUNAWAY_PAUSE_REASON);
      expect(after.pausedAt).not.toBeNull();
      expect(sentEmails.map((email) => email.kind)).toEqual(["paused"]);
    });

    it("does not pause on a ratio measured over too little traffic", async () => {
      // Two matches out of two traces is 100% and means nothing. Without a
      // floor, a quiet project would auto-pause on its first busy minute.
      const row = await storeTrigger();
      projectTraces24h = 10;

      await handlePersistCapBreach(deps(), breach(summary(row), 110));

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: project.id },
      });
      expect(after.active).toBe(true);
    });

    /** @scenario "A grandfathered match-everything automation is paused on breach" */
    it("pauses an automation that has no condition at all", async () => {
      const row = await storeTrigger({ filters: "{}" });
      // High traffic and a small share, so the only thing that can pause this
      // is the shape of the automation itself.
      projectTraces24h = 1_000_000;

      await handlePersistCapBreach(
        deps(),
        breach(summary(row, { filters: {} }), 150),
      );

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: project.id },
      });
      expect(after.active).toBe(false);
      expect(after.pausedReason).toBe(RUNAWAY_PAUSE_REASON);
    });

    /** @scenario "A paused automation stops recording matches" */
    it("drops out of the active list the match subscriber reads", async () => {
      const row = await storeTrigger({ filters: "{}" });
      projectTraces24h = 1_000_000;
      expect(
        (await triggers.getActiveTraceTriggersForProject(project.id)).map(
          (trigger) => trigger.id,
        ),
      ).toContain(row.id);

      await handlePersistCapBreach(
        deps(),
        breach(summary(row, { filters: {} }), 150),
      );

      // The pause invalidates the cache, so the subscriber stops recording
      // matches immediately rather than after the TTL expires.
      expect(
        (await triggers.getActiveTraceTriggersForProject(project.id)).map(
          (trigger) => trigger.id,
        ),
      ).not.toContain(row.id);
    });
  });

  describe("when a breach is handled", () => {
    async function counterValue(
      name: string,
      labels?: Record<string, string>,
    ): Promise<number> {
      const metric = await register.getSingleMetric(name)!.get();
      const sample = labels
        ? metric.values.find((value) =>
            Object.entries(labels).every(
              ([key, want]) => value.labels[key] === want,
            ),
          )
        : metric.values[0];
      return sample?.value ?? 0;
    }

    /** @scenario "A breach raises a team metric rather than only a customer email" */
    it("counts it for the team, not only for the customer's inbox", async () => {
      // The customer email is one recipient of one breach. The metric is how
      // the team sees the fleet, which is what an alert rule can watch.
      const row = await storeTrigger();
      const before = await counterValue("automation_ceiling_breach_total");

      await handlePersistCapBreach(deps(), breach(summary(row), 150));

      expect(
        (await counterValue("automation_ceiling_breach_total")) - before,
      ).toBe(1);
    });

    it("counts an auto-pause under its reason", async () => {
      const row = await storeTrigger({ filters: "{}" });
      projectTraces24h = 1_000_000;
      const before = await counterValue("automation_auto_paused_total", {
        reason: RUNAWAY_PAUSE_REASON,
      });

      await handlePersistCapBreach(
        deps(),
        breach(summary(row, { filters: {} }), 150),
      );

      expect(
        (await counterValue("automation_auto_paused_total", {
          reason: RUNAWAY_PAUSE_REASON,
        })) - before,
      ).toBe(1);
    });
  });

  describe("when the customer resumes a paused automation", () => {
    /** @scenario "Resuming a paused automation clears the pause reason" */
    it("clears both the reason and the pause time", async () => {
      const row = await storeTrigger({ filters: "{}" });
      projectTraces24h = 1_000_000;
      await handlePersistCapBreach(
        deps(),
        breach(summary(row, { filters: {} }), 150),
      );

      // The same write `toggleTrigger` issues when a customer switches it
      // back on.
      await triggers.update({
        triggerId: row.id,
        projectId: project.id,
        data: { active: true, pausedReason: null, pausedAt: null },
      });

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: project.id },
      });
      expect(after.active).toBe(true);
      expect(after.pausedReason).toBeNull();
      expect(after.pausedAt).toBeNull();
    });
  });
});
