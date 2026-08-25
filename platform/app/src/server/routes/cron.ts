/**
 * Hono routes for cron jobs.
 */

import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { env } from "~/env.mjs";
import { createServiceApp, internalSecret } from "~/server/api/security";
import { prisma } from "~/server/db";
import { USAGE_UNKNOWN } from "~/server/traces/usage-count";
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

      const usageService = c.app.usage;

      for (const org of organizations) {
        try {
          const projectIds = await c.app.organizations.getProjectIds(org.id);
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

          if (currentMonthCount === USAGE_UNKNOWN) {
            // Skipped, not treated as 0. This job decides whether an
            // organization has crossed a usage threshold; against a fabricated
            // zero it concludes "comfortably under" for every organization at
            // once and sends nothing, which is indistinguishable from a quiet
            // day. Skipping says the same thing honestly and re-checks on the
            // next tick.
            logger.warn(
              { organizationId: org.id },
              "usage is unknown, skipping usage check for this organization",
            );
            continue;
          }

          const activePlan = await c.app.planProvider.getActivePlan({
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

          await c.app.usageLimits.checkAndSendWarning({
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

// NOTE: the `/api/cron/triggers` graph-alert sweep was removed (ADR-034):
// custom-graph threshold alerts now fire exclusively from the event-sourced
// path (real-time activity subscriber + scheduled graph-alert process manager),
// and trace-based triggers were already reactive. There is no cron graph-alert
// path anymore. Likewise the webhook delivery-log prune (ADR-040 §6) runs as
// the daily `webhookDeliveryPrune` scheduled process manager on the worker,
// not as a cron route.

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
