/**
 * Hono routes for cron jobs.
 */
import type { Project, Trigger } from "@prisma/client";
import type { Context } from "hono";
import { env } from "~/env.mjs";
import { processCustomGraphTrigger } from "~/pages/api/cron/triggers/customGraphTrigger";
import { createServiceApp, internalSecret } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import cleanupOldLambdas from "~/tasks/cleanupOldLambdas";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  reportHasFailures,
  type SeedRunReport,
} from "../../../scripts/dogfood/governance/_lib/seedRunner";
import { runSeedDemo } from "../../../scripts/dogfood/governance/seed-demo";
import { validateInternalSecret } from "./_lib/internal-secret";

const logger = createLogger("langwatch:cron");

const secured = createServiceApp({ basePath: "/api" });

type CronContext = Context;

const cronPolicy = () =>
  internalSecret(
    "cron shared secret validated in-handler via validateInternalSecret",
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

  const results = [];

  for (const trigger of graphTriggers) {
    try {
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
