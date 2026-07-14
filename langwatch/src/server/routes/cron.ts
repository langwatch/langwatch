/**
 * Hono routes for cron jobs.
 */

import { createLogger } from "@langwatch/telemetry";
import type { Project, Trigger } from "@prisma/client";
import type { Context } from "hono";
import { env } from "~/env.mjs";
import { processCustomGraphTrigger } from "~/pages/api/cron/triggers/customGraphTrigger";
import { createServiceApp, internalSecret } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { scheduleTopicClustering } from "~/server/topicClustering/topicClusteringQueue";
import cleanupOldLambdas from "~/tasks/cleanupOldLambdas";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  reportHasFailures,
  type SeedRunReport,
} from "../../../scripts/dogfood/governance/_lib/seedRunner";
import { runSeedDemo } from "../../../scripts/dogfood/governance/seed-demo";
import {
  isInternalSecretValid,
  validateInternalSecret,
} from "./_lib/internal-secret";

const logger = createLogger("langwatch:cron");

// Builder-enforced secret gate: every route registered on this app passes
// through the shared-secret check before its handler runs, so a future cron
// route whose author forgets the in-handler validateCronKey call still ships
// authenticated. The per-handler checks below stay as belt-and-braces.
const secured = createServiceApp({
  basePath: "/api",
  verifySecret: async (c, next) => {
    if (!isInternalSecretValid(c.req.header("authorization"))) {
      return c.body(null, 401);
    }
    await next();
  },
});

type CronContext = Context;

const cronPolicy = () =>
  internalSecret(
    "cron shared secret enforced by the builder-level verifySecret middleware " +
      "(and re-checked in-handler via validateInternalSecret)",
  );

/** Validates the cron shared secret. See validateInternalSecret (fail-closed + constant-time). */
function validateCronKey(c: CronContext): boolean {
  return validateInternalSecret(c);
}

// ---------- GET|POST /api/cron/old_lambdas_cleanup ----------
const oldLambdasCleanupHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  try {
    await cleanupOldLambdas();
    return c.json({ message: "Old lambdas deleted successfully" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error deleting old lambdas",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
};
secured
  .access(cronPolicy())
  .get("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);
secured
  .access(cronPolicy())
  .post("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);

// ---------- GET|POST /api/cron/schedule_topic_clustering ----------
const scheduleTopicClusteringHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }
  try {
    await scheduleTopicClustering();
    return c.json({ message: "Topic clustering scheduled" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error scheduling topic clustering",
        error: error?.message ? error?.message.toString() : `${error}`,
      },
      500,
    );
  }
};
secured
  .access(cronPolicy())
  .get("/cron/schedule_topic_clustering", scheduleTopicClusteringHandler);
secured
  .access(cronPolicy())
  .post("/cron/schedule_topic_clustering", scheduleTopicClusteringHandler);

// ---------- GET /api/cron/trace_analytics ----------
secured.access(cronPolicy()).get("/cron/trace_analytics", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  // Check usage limits for all organizations (SaaS only)
  if (env.IS_SAAS) {
    try {
      const organizations = await prisma.organization.findMany({
        select: { id: true },
      });

      const usageService = getApp().usage;

      for (const org of organizations) {
        try {
          const projectIds = await getApp().organizations.getProjectIds(org.id);
          if (projectIds.length === 0) {
            logger.debug(
              { organizationId: org.id },
              "organization has no projects, skipping",
            );
            continue;
          }
          const currentMonthCount = await usageService.getCurrentMonthCount({
            organizationId: org.id,
          });

          if (currentMonthCount === "unlimited") {
            logger.debug(
              { organizationId: org.id },
              "organization has unlimited plan, skipping usage check",
            );
            continue;
          }

          const activePlan = await getApp().planProvider.getActivePlan({
            organizationId: org.id,
          });

          if (
            !activePlan ||
            typeof activePlan.maxMessagesPerMonth !== "number" ||
            activePlan.maxMessagesPerMonth <= 0
          ) {
            logger.debug(
              { organizationId: org.id },
              "organization has invalid or missing plan configuration, skipping",
            );
            continue;
          }

          const maxMessagesPerMonth = activePlan.maxMessagesPerMonth;
          const usagePercentage =
            maxMessagesPerMonth > 0
              ? (currentMonthCount / maxMessagesPerMonth) * 100
              : 0;

          if (currentMonthCount > 1) {
            logger.info(
              {
                organizationId: org.id,
                currentMonthMessagesCount: currentMonthCount,
                maxMessagesPerMonth,
                usagePercentage: Number(usagePercentage.toFixed(1)),
                projectCount: projectIds.length,
              },
              "organization usage stats",
            );
          }

          await getApp().usageLimits.checkAndSendWarning({
            organizationId: org.id,
            currentMonthMessagesCount: currentMonthCount,
            maxMonthlyUsageLimit: maxMessagesPerMonth,
          });
        } catch (error) {
          logger.error(
            { organizationId: org.id, error },
            "error checking usage limits for organization",
          );
          captureException(toError(error), {
            extra: { organizationId: org.id },
          });
        }
      }
    } catch (error) {
      logger.error({ error }, "error checking usage limits");
      captureException(toError(error));
    }
  } else {
    logger.debug("skipping usage limit notifications (not SaaS)");
  }

  return c.json({ success: true });
});

// ---------- GET /api/cron/triggers ----------
secured.access(cronPolicy()).get("/cron/triggers", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  let triggers: Trigger[];
  let projects: Project[];

  try {
    projects = await prisma.project.findMany({
      where: { firstMessage: true, archivedAt: null },
    });

    triggers = await prisma.trigger.findMany({
      where: {
        active: true,
        projectId: { in: projects.map((project) => project.id) },
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to fetch triggers",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }

  // Only process custom graph triggers — trace-based triggers are handled
  // reactively by the alertTrigger reactor on the trace-processing pipeline.
  const graphTriggers = triggers.filter((t) => t.customGraphId);

  // ADR-034 Phase 5: skip triggers whose project has flipped onto the
  // event-sourced graph-trigger path (real-time outbox reactor + 30s
  // heartbeat handle them there). The flag is a PROJECT-level decision;
  // resolve it once per distinct projectId per tick instead of once per
  // trigger — N graph triggers in the same project would otherwise fan
  // out to N flag lookups, all with the same answer. Cache-warm case is
  // in-process; cold case is one Redis GET per project either way.
  const distinctProjectIds = Array.from(
    new Set(graphTriggers.map((t) => t.projectId)),
  );
  const esFlaggedProjectIds = new Set<string>();
  await Promise.all(
    distinctProjectIds.map(async (projectId) => {
      try {
        const onEsPath = await featureFlagService.isEnabled(
          "release_es_graph_triggers_firing",
          { distinctId: projectId, projectId },
        );
        if (onEsPath) esFlaggedProjectIds.add(projectId);
      } catch (error) {
        // A flag lookup failing (Redis blip) must not reject the whole
        // Promise.all — that would abort this tick for EVERY project, not
        // just this one. Leave the project unflagged so the cron keeps
        // evaluating it: a duplicate notification is deduped by TriggerSent,
        // whereas skipping it would silently drop the alert.
        logger.error(
          { projectId, error },
          "[graph-trigger] flag lookup failed; leaving project on the cron path",
        );
      }
    }),
  );

  const results = [];

  for (const trigger of graphTriggers) {
    try {
      if (esFlaggedProjectIds.has(trigger.projectId)) {
        logger.info(
          { triggerId: trigger.id, projectId: trigger.projectId },
          "[graph-trigger] skipping in cron — project on event-sourced path",
        );
        continue;
      }
      const result = await processCustomGraphTrigger(trigger, projects);
      results.push(result);
    } catch (error) {
      logger.error(
        { triggerId: trigger.id, error },
        "error processing custom graph trigger",
      );
      results.push({
        triggerId: trigger.id,
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        type: "customGraph",
      });
    }
  }

  return c.json(results);
});

// ---------- POST /api/cron/seed_demo ----------
//
// Triggers a daily reset of the canonical demo org allowlist. The
// langwatch-saas Kubernetes CronJob curls this route with the
// `CRON_API_KEY` Bearer header. `runSeedDemo` is the same code path the
// dev CLI uses (`scripts/dogfood/governance/seed-demo.ts`), gated by
// the `DEMO_ORG_IDS` allowlist guard so an unset env returns a clean
// 500 instead of touching real customer data.
//
// Returns the SeedRunReport JSON either way; HTTP 500 when any action
// failed so CronJob alerting can fire on the response code.
const seedDemoHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }
  let report: SeedRunReport;
  try {
    report = await runSeedDemo({ execute: true });
  } catch (error: any) {
    logger.error({ error }, "demo seed run threw before completing");
    return c.json(
      {
        message: "demo seed run threw",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
  const status = reportHasFailures(report) ? 500 : 200;
  return c.json({ report }, status);
};
secured.access(cronPolicy()).get("/cron/seed_demo", seedDemoHandler);
secured.access(cronPolicy()).post("/cron/seed_demo", seedDemoHandler);

export const app = secured.hono;
