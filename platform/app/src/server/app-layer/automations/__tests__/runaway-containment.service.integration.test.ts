/**
 * Containment decides whether a busy automation is throttled or stopped, and
 * getting that wrong in either direction is expensive: pausing a legitimate
 * automation breaks a customer's pipeline, and not pausing a misconfigured one
 * is the incident that produced this work. These run against real trigger rows
 * because "stays active" and "is paused with a reason" are claims about what is
 * actually in the database, not about what a mock was called with.
 */

import { nanoid } from "nanoid";
import { register } from "prom-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";

// Registers the counters the metric assertions read back.
import "~/server/metrics";

import type { TriggerSummary } from "../trigger-summary";
import { RUNAWAY_PAUSE_REASON } from "@langwatch/automation-contract";
import {
  AppAutomationRuntime,
  createAppAutomationTestFirePort,
  createAppAutomationTestGraphPorts,
} from "~/runtime/app/features/automation";
import type {
  AutomationPersistCapBreach,
  AutomationService,
} from "@langwatch/automation-contract";
import {
  incrementAutomationAutoPausedTotal,
  incrementAutomationCeilingBreachTotal,
  incrementAutomationContainmentFailedTotal,
} from "~/server/metrics";

describe("Feature: runaway automation containment", () => {
  const ns = `runaway-${nanoid(8)}`;

  // Optional until `beforeAll` has actually created them: a setup failure part
  // way through must not make teardown throw on an undefined id, because that
  // TypeError replaces the real setup error in the CI output.
  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;
  let triggers: AutomationService;
  type AutomationRunawayPort = Parameters<
    typeof AppAutomationRuntime.create
  >[0]["graph"]["runaway"];
  let runawayRuntime: AutomationRunawayPort;

  let projectTraces24h = 10_000;
  let sentEmails: Array<{ kind: string; skippedToday: number }>;
  let claimed: Map<string, string>;
  /** Set to make `pauseTrigger` throw, standing in for a Prisma timeout. */
  let pauseFails = false;
  let pauseAttempts = 0;
  /** Set to make the limit mail throw, standing in for an SMTP refusal. */
  let mailFails = false;
  let mailAttempts = 0;

  const projectId = () => project!.id;

  function runtime(): AutomationRunawayPort {
    return {
      ...createAppAutomationTestGraphPorts().runaway,
      countProjectTraces24h: async () => projectTraces24h,
      notificationRecipients: async () => ["admin@example.com"],
      sendLimitEmail: async ({ kind, skippedToday }) => {
        mailAttempts++;
        if (mailFails) throw new Error("smtp refused the connection");
        sentEmails.push({ kind, skippedToday });
      },
      // A real SET-NX has the same shape: a lease only for the first claimant,
      // and a release that drops the key only while that lease still holds it.
      claimOnce: async (key) => {
        if (claimed.has(key)) return null;
        const token = nanoid();
        claimed.set(key, token);
        return { key, token };
      },
      releaseClaim: async ({ key, token }) => {
        if (claimed.get(key) === token) claimed.delete(key);
      },
      projectName: async () => "Test project",
      automationUrl: async () => "https://app.example.test/automations",
      telemetry: {
        onCeilingBreach: incrementAutomationCeilingBreachTotal,
        onAutoPaused: () => incrementAutomationAutoPausedTotal(RUNAWAY_PAUSE_REASON),
        onContainmentFailed: incrementAutomationContainmentFailedTotal,
        log: {
          error: () => undefined,
          info: () => undefined,
        },
      },
    };
  }

  async function storeTrigger(
    overrides: { filters?: string; filterQuery?: string | null } = {},
  ) {
    return prisma.trigger.create({
      data: {
        id: nanoid(),
        name: `Automation ${nanoid(4)}`,
        projectId: projectId(),
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: {},
        filters: overrides.filters ?? JSON.stringify({ "metadata.labels": ["prod"] }),
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
      projectId: projectId(),
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
    projectId: projectId(),
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
    const graph = createAppAutomationTestGraphPorts();
    runawayRuntime = runtime();
    triggers = AppAutomationRuntime.create({
      database: prisma,
      redis: null,
      graph: { ...graph, runaway: runawayRuntime },
      testFire: createAppAutomationTestFirePort(),
    }).build();

    const update = triggers.update.bind(triggers);
    vi.spyOn(triggers, "update").mockImplementation(async (input) => {
      if (input.pausedReason === RUNAWAY_PAUSE_REASON) {
        pauseAttempts++;
        if (pauseFails) throw new Error("connection terminated");
      }
      return update(input);
    });
  });

  beforeEach(() => {
    projectTraces24h = 10_000;
    sentEmails = [];
    claimed = new Map();
    pauseFails = false;
    pauseAttempts = 0;
    mailFails = false;
    mailAttempts = 0;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Innermost first, and each one guarded on its own: `beforeAll` can fail
    // between any two creates, and teardown has to clean up what exists
    // without inventing an error about what does not.
    if (project) {
      await prisma.trigger.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  describe("when a selective automation passes its ceiling", () => {
    /** @scenario "A throttled automation stays active" */
    it("leaves it running so it dispatches again tomorrow", async () => {
      const row = await storeTrigger();

      await triggers.handlePersistCapBreach(breach(summary(row), 150));

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: projectId() },
      });
      expect(after.active).toBe(true);
      expect(after.pausedReason).toBeNull();
    });

    /** @scenario "A busy but selective automation is never paused" */
    it("sends no pause email when its matches are a small share of traffic", async () => {
      const row = await storeTrigger();
      projectTraces24h = 10_000;

      await triggers.handlePersistCapBreach(breach(summary(row), 150));

      expect(sentEmails.map((email) => email.kind)).toEqual(["ceiling_reached"]);
    });

    /** @scenario "The customer is emailed once on the first day a trigger breaches" */
    it("emails once however many matches breach that day", async () => {
      const row = await storeTrigger();
      // Expiring the evaluation-rate claim between breaches stands in for the
      // minute between windows: each breach here re-evaluates in full, so the
      // single mail below is the DAY-long mail claim doing its job, not the
      // short claim in front of it.
      const checkClaim = `automation-containment-check:${row.id}`;
      await triggers.handlePersistCapBreach(breach(summary(row), 101));
      claimed.delete(checkClaim);
      await triggers.handlePersistCapBreach(breach(summary(row), 102));
      claimed.delete(checkClaim);
      await triggers.handlePersistCapBreach(breach(summary(row), 500));

      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]).toMatchObject({ kind: "ceiling_reached" });
    });

    /** @scenario "A limit email that could not be sent is tried again" */
    it("does not spend the day's one email on a send that failed", async () => {
      const row = await storeTrigger();
      const checkClaim = `automation-containment-check:${row.id}`;

      mailFails = true;
      await triggers.handlePersistCapBreach(breach(summary(row), 101));
      expect(sentEmails).toHaveLength(0);
      expect(mailAttempts).toBe(1);

      // The day-long claim is what makes the mail once-only, so holding it
      // through a failed send would cost the customer the single message that
      // explains why their automation stopped producing records.
      claimed.delete(checkClaim);
      mailFails = false;
      await triggers.handlePersistCapBreach(breach(summary(row), 102));

      expect(sentEmails.map((email) => email.kind)).toEqual(["ceiling_reached"]);

      // And once it has landed, the claim holds again for the rest of the day.
      claimed.delete(checkClaim);
      await triggers.handlePersistCapBreach(breach(summary(row), 103));

      expect(sentEmails).toHaveLength(1);
    });

    /** @scenario "A breach storm measures the project's traffic once per window" */
    it("reads the project's traffic once for a whole storm of breaches", async () => {
      const row = await storeTrigger();
      const sharedDeps = runawayRuntime;
      let trafficReads = 0;
      sharedDeps.countProjectTraces24h = async () => {
        trafficReads++;
        return projectTraces24h;
      };

      for (let index = 0; index < 5; index++) {
        await triggers.handlePersistCapBreach(breach(summary(row), 101 + index));
      }

      // The pause decision costs a ClickHouse distinct-count over 24h of
      // traffic. The storm has to be absorbed before that query, not after.
      expect(trafficReads).toBe(1);
    });
  });

  describe("when the automation is matching essentially all of the project", () => {
    /** @scenario "An automation matching nearly all traffic is paused" */
    it("pauses it with a runaway reason and tells the customer", async () => {
      const row = await storeTrigger();
      projectTraces24h = 1_000;

      await triggers.handlePersistCapBreach(breach(summary(row), 990));

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: projectId() },
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

      await triggers.handlePersistCapBreach(breach(summary(row), 110));

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: projectId() },
      });
      expect(after.active).toBe(true);
    });

    /** @scenario "A grandfathered match-everything automation is paused on breach" */
    it("pauses an automation that has no condition at all", async () => {
      const row = await storeTrigger({ filters: "{}" });
      // High traffic and a small share, so the only thing that can pause this
      // is the shape of the automation itself.
      projectTraces24h = 1_000_000;

      await triggers.handlePersistCapBreach(breach(summary(row, { filters: {} }), 150));

      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: projectId() },
      });
      expect(after.active).toBe(false);
      expect(after.pausedReason).toBe(RUNAWAY_PAUSE_REASON);
    });

    /** @scenario "A paused automation stops recording matches" */
    it("drops out of the active list the match subscriber reads", async () => {
      const row = await storeTrigger({ filters: "{}" });
      projectTraces24h = 1_000_000;
      expect(
        (await triggers.getActiveTraceTriggersForProject(projectId())).map(
          (trigger) => trigger.id,
        ),
      ).toContain(row.id);

      await triggers.handlePersistCapBreach(breach(summary(row, { filters: {} }), 150));

      // The pause invalidates the cache, so the subscriber stops recording
      // matches immediately rather than after the TTL expires.
      expect(
        (await triggers.getActiveTraceTriggersForProject(projectId())).map(
          (trigger) => trigger.id,
        ),
      ).not.toContain(row.id);
    });
  });

  describe("given the pause write fails", () => {
    describe("when a later breach arrives", () => {
      /** @scenario "A failed pause is retried rather than claimed away" */
      it("retries the pause instead of standing down for the day", async () => {
        const row = await storeTrigger({ filters: "{}" });
        projectTraces24h = 1_000_000;
        pauseFails = true;
        await triggers.handlePersistCapBreach(breach(summary(row, { filters: {} }), 150));
        expect(pauseAttempts).toBe(1);
        expect(
          await prisma.trigger.findUniqueOrThrow({
            where: { id: row.id, projectId: projectId() },
          }),
        ).toMatchObject({ active: true, pausedReason: null });

        // The claim the first attempt took is short-lived and gates only the
        // attempt. Expiring it stands in for the minute that passes before the
        // next breach; a day-long claim taken before the write would leave the
        // runaway automation active until the UTC day rolled over.
        claimed.clear();
        pauseFails = false;
        await triggers.handlePersistCapBreach(breach(summary(row, { filters: {} }), 200));

        expect(pauseAttempts).toBe(2);
        const after = await prisma.trigger.findUniqueOrThrow({
          where: { id: row.id, projectId: projectId() },
        });
        expect(after.active).toBe(false);
        expect(after.pausedReason).toBe(RUNAWAY_PAUSE_REASON);
      });

      it("sends no pause email for the attempt that never landed", async () => {
        const row = await storeTrigger({ filters: "{}" });
        projectTraces24h = 1_000_000;
        pauseFails = true;

        await triggers.handlePersistCapBreach(breach(summary(row, { filters: {} }), 150));

        // Telling a customer we paused something we did not pause is worse
        // than telling them nothing.
        expect(sentEmails).toEqual([]);
      });
    });
  });

  describe("given a storm of breaches on one trigger", () => {
    describe("when each one is handled", () => {
      it("writes the pause once rather than once per breach", async () => {
        const row = await storeTrigger({ filters: "{}" });
        projectTraces24h = 1_000_000;
        for (let index = 0; index < 5; index++) {
          await triggers.handlePersistCapBreach(
            breach(summary(row, { filters: {} }), 150 + index),
          );
        }

        // Thousands of dispatches can already be in flight when the ceiling
        // breaks; the short claim is what stops each of them issuing its own
        // update.
        expect(pauseAttempts).toBe(1);
        expect(sentEmails.map((email) => email.kind)).toEqual(["paused"]);
      });
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
            Object.entries(labels).every(([key, want]) => value.labels[key] === want),
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

      await triggers.handlePersistCapBreach(breach(summary(row), 150));

      expect((await counterValue("automation_ceiling_breach_total")) - before).toBe(1);
    });

    it("counts an auto-pause under its reason", async () => {
      const row = await storeTrigger({ filters: "{}" });
      projectTraces24h = 1_000_000;
      const before = await counterValue("automation_auto_paused_total", {
        reason: RUNAWAY_PAUSE_REASON,
      });

      await triggers.handlePersistCapBreach(breach(summary(row, { filters: {} }), 150));

      expect(
        (await counterValue("automation_auto_paused_total", {
          reason: RUNAWAY_PAUSE_REASON,
        })) - before,
      ).toBe(1);
    });
  });

  // Resuming lives in the tRPC `toggleTrigger` mutation, so the scenario
  // "Resuming a paused automation clears the pause reason" is bound in the
  // router suite, where the mutation itself runs.
});
